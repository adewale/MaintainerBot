"use agent";

import {
  type AgentProps,
  type SandboxFactory,
  useAgentFinish,
  useAgentStart,
  useDataWriter,
  useInitialData,
  useModel,
  usePersistentState,
  useSandbox,
  useTool,
} from "@flue/runtime";
import { local } from "@flue/runtime/node";
import * as v from "valibot";
import "../providers.ts";

const DeepVerifyDataSchema = v.object({
  repo: v.pipe(v.string(), v.regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)),
  ref: v.optional(v.pipe(v.string(), v.regex(/^[A-Za-z0-9._/-]+$/))),
  model: v.optional(v.string()),
});

type DeepVerifyData = v.InferOutput<typeof DeepVerifyDataSchema>;

const VerificationSchema = v.object({
  status: v.picklist(["verified", "failed", "skipped"]),
  summary: v.string(),
  commandsRun: v.array(v.string()),
  findings: v.array(
    v.object({
      severity: v.picklist(["info", "warning", "failure"]),
      title: v.string(),
      evidence: v.array(v.string()),
      recommendedAction: v.string(),
    }),
  ),
  cliOnlyOpportunities: v.array(v.string()),
});

const restrictedLocal = (): SandboxFactory => {
  const factory = local();
  return { createSessionEnv: factory.createSessionEnv, tools: () => [] };
};

export function DeepVerify({ id }: AgentProps) {
  const data = useInitialData<DeepVerifyData>();
  useModel(data.model ?? verifierModel());
  useSandbox(restrictedLocal());
  const [commandsRun, setCommandsRun] = usePersistentState<string[]>(
    "commandsRun",
    [],
  );
  const writeVerification = useDataWriter("verification", {
    schema: VerificationSchema,
  });
  const checkout = `/tmp/maintainerbot-deep-verify-${id.replace(/[^A-Za-z0-9_.-]/g, "-")}`;
  const contextPath = `${checkout}/PREPARATION.json`;

  useAgentStart(async ({ harness, log }) => {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "MaintainerBot",
    };
    if (process.env.GITHUB_TOKEN)
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const response = await fetch(`https://api.github.com/repos/${data.repo}`, {
      headers,
    });
    if (!response.ok)
      throw new Error(`Failed to fetch ${data.repo}: HTTP ${response.status}`);
    const metadata = (await response.json()) as {
      pushed_at?: string;
      clone_url?: string;
      default_branch?: string;
    };
    await harness.sandbox.rm(checkout, { recursive: true, force: true });
    await harness.sandbox.mkdir(checkout, { recursive: true });

    if (
      !metadata.pushed_at ||
      metadata.pushed_at < "2025-11-17T00:00:00.000Z"
    ) {
      await harness.sandbox.writeFile(
        contextPath,
        JSON.stringify(
          {
            status: "skipped",
            repo: data.repo,
            pushedAt: metadata.pushed_at ?? null,
            reason: "Repository is older than the verification cutoff.",
          },
          null,
          2,
        ),
      );
      return;
    }

    const ref = data.ref ?? metadata.default_branch ?? "main";
    const cloneUrl =
      metadata.clone_url ?? `https://github.com/${data.repo}.git`;
    const clone = await harness.sandbox.exec(
      `git clone --depth 1 --branch ${shellQuote(ref)} ${shellQuote(cloneUrl)} ${shellQuote(`${checkout}/repo`)}`,
      { timeoutMs: 5 * 60 * 1000 },
    );
    if (clone.exitCode !== 0)
      throw new Error(`Clone failed: ${clone.stderr || clone.stdout}`);
    const inventory = await harness.sandbox.exec(
      "find . -maxdepth 2 -type f \\( -name package.json -o -name pnpm-lock.yaml -o -name package-lock.json -o -name bun.lockb -o -name pyproject.toml -o -name README.md -o -name TODO.md -o -path './.github/workflows/*' \\) | sort | head -200",
      { cwd: `${checkout}/repo`, timeoutMs: 30_000 },
    );
    await harness.sandbox.writeFile(
      contextPath,
      JSON.stringify(
        {
          status: "ready",
          repo: data.repo,
          ref,
          pushedAt: metadata.pushed_at,
          inventory: inventory.stdout,
        },
        null,
        2,
      ),
    );
    log.info("repository prepared", { repo: data.repo, ref });
  });

  useTool({
    name: "load_repository_context",
    description:
      "Load trusted repository metadata and the bounded file inventory. Call this first.",
    harness: true,
    async run({ harness }) {
      return await harness.sandbox.readFile(contextPath);
    },
  });

  useTool({
    name: "read_repository_file",
    description: "Read one UTF-8 file inside the prepared repository checkout.",
    input: v.object({ path: v.string() }),
    harness: true,
    async run({ harness, data: input }) {
      const path = safeRelativePath(input.path);
      const content = await harness.sandbox.readFile(
        `${checkout}/repo/${path}`,
      );
      return content.slice(0, 50_000);
    },
  });

  useTool({
    name: "run_verification_command",
    description:
      "Run one allowlisted verification executable in the prepared checkout. At most five calls are allowed.",
    input: v.object({
      executable: v.picklist(["pnpm", "npm", "bun", "node", "python3"]),
      args: v.array(v.string()),
    }),
    harness: true,
    async run({ harness, data: command }) {
      let accepted = false;
      const rendered = [command.executable, ...command.args]
        .map(shellQuote)
        .join(" ");
      setCommandsRun((previous) => {
        if (previous.length >= 5) return previous;
        accepted = true;
        return [...previous, rendered];
      });
      if (!accepted)
        throw new Error(
          "The five-command verification limit has been reached.",
        );
      const result = await harness.sandbox.exec(rendered, {
        cwd: `${checkout}/repo`,
        timeoutMs: 10 * 60 * 1000,
      });
      return {
        output: {
          command: rendered,
          exitCode: result.exitCode,
          stdout: result.stdout.slice(-20_000),
          stderr: result.stderr.slice(-20_000),
        },
      };
    },
  });

  useTool({
    name: "submit_verification",
    description:
      "Submit the final structured verification after checks are complete.",
    input: VerificationSchema,
    run({ data: verification }) {
      writeVerification(verification);
      return { output: "Verification submitted.", terminate: true };
    },
  });

  useAgentFinish(({ response, append }) => {
    const submitted = response.toolCalls.some(
      (call) => call.tool === "submit_verification" && !call.isError,
    );
    if (submitted) return;
    append({
      kind: "signal",
      type: "verification.result.required",
      body: "Call submit_verification with the final evidence-backed result now.",
    });
  });

  return `You are MaintainerBot's CLI-only deep verifier for ${data.repo}${data.ref ? ` at ${data.ref}` : ""}.

Stay read-only with respect to GitHub: never push, open PRs, comment, label, or mutate remote state. Trusted code has prepared repository metadata and, when eligible, a temporary checkout. Call load_repository_context first. If its status is skipped, submit a skipped result without running commands. Otherwise inspect only through read_repository_file and run at most five focused checks through run_verification_command. Prefer documented test, check, lint, and build scripts. Report concrete output and skipped checks honestly, then call submit_verification. The local host is not an isolation boundary; use this agent only for repositories you trust.`;
}

function verifierModel() {
  const configured = process.env.FLUE_MODEL;
  const provider = configured?.split("/", 1)[0];
  if (configured && provider === "anthropic" && process.env.ANTHROPIC_API_KEY)
    return configured;
  if (configured && provider === "openai" && process.env.OPENAI_API_KEY)
    return configured;
  if (configured && provider === "openrouter" && process.env.OPENROUTER_API_KEY)
    return configured;
  if (process.env.OPENAI_API_KEY) return "openai/gpt-4.1-mini";
  if (process.env.OPENROUTER_API_KEY)
    return "openrouter/anthropic/claude-3.5-haiku";
  return "anthropic/claude-haiku-4-5";
}

export function safeRelativePath(path: string) {
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.split("/").some((part) => part === ".." || part === ".")
  ) {
    throw new Error("path must be a safe repository-relative path");
  }
  return path;
}

export function shellQuote(value: string) {
  if (value.includes("\0") || value.includes("\n") || value.includes("\r"))
    throw new Error("command values must not contain control characters");
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

DeepVerify.agentName = "deep-verify";
DeepVerify.initialData = DeepVerifyDataSchema;
DeepVerify.durability = { maxAttempts: 3, timeoutMs: 30 * 60 * 1000 };
