/**
 * Known-bad and known-good inputs for scripts/check-secrets.mjs, the CI secret
 * scanner. Each case runs the real script in its own temporary checkout.
 *
 * Fake credentials are assembled at runtime so that this file does not trip
 * the scanner when it runs over the repository itself.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(
  new URL("../scripts/check-secrets.mjs", import.meta.url),
);
const body = (length: number, alphabet = "aB3dE5gH7jK9mN1pQ") =>
  Array.from({ length }, (_, i) => alphabet[i % alphabet.length]).join("");

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scan(files: Record<string, string | Buffer>) {
  const root = mkdtempSync(join(tmpdir(), "check-secrets-"));
  dirs.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: root,
    encoding: "utf8",
  });
  return { status: result.status, output: result.stdout + result.stderr };
}

describe("check-secrets: known-bad inputs fail the scan", () => {
  it.each([
    ["Anthropic API key", "Anthropic API key", `const k = "${"sk-" + "ant-api03-" + body(48)}";\n`],
    ["OpenAI API key", "OpenAI API key", `const k = "${"sk-" + body(48)}";\n`],
    [
      "OpenAI project API key",
      "OpenAI API key",
      `const k = "${"sk-" + "proj-" + body(40) + "_-" + body(40)}";\n`,
    ],
    ["GitHub token", "GitHub token", `const k = "${"ghp" + "_" + body(36)}";\n`],
    [
      "Private key block",
      "Private key block",
      `${"-----BEGIN " + "PRIVATE KEY-----"}\nMIIEv\n-----END PRIVATE KEY-----\n`,
    ],
    [
      "Env assignment",
      "Env assignment with secret-ish name",
      `${"DEPLOY_" + "TOKEN"}=${body(16)}\n`,
    ],
    [
      "Long token next to a Bearer header",
      "Cloudflare API token-like value",
      `curl -H "Authorization: ${"Bear" + "er"} ${body(48)}"\n`,
    ],
  ])("%s", (_name, finding, content) => {
    const result = scan({ "src/config.ts": content });
    expect(result.status).toBe(1);
    expect(result.output).toMatch(new RegExp(`src/config\\.ts:\\d+ ${finding} \\(`));
  });
});

describe("check-secrets: known-good inputs pass the scan", () => {
  it("passes a clean checkout and reports it", () => {
    const result = scan({ "README.md": "# Project\n" });
    expect(result.status).toBe(0);
    expect(result.output).toContain("No obvious secrets found.");
  });

  it("allows documented placeholders and env references", () => {
    const result = scan({
      "README.md": [
        "ANTHROPIC_API_KEY=...",
        "GITHUB_TOKEN=github_pat_or_classic_token",
        "RESEND_API_KEY=your-resend-key",
        `const ${"GITHUB_" + "TOKEN"} = env.GITHUB_TOKEN;`,
      ].join("\n"),
    });
    expect(result.status, result.output).toBe(0);
  });

  it("does not flag long identifiers far from credential words", () => {
    const result = scan({
      "docs/history.md": `Fixed in commit ${"2dc2e95e19ecb2ca205a" + "0d06182f3c34aee8cb48"} last week.\n`,
    });
    expect(result.status, result.output).toBe(0);
  });

  it("skips .env.example, dependency, build and binary files", () => {
    const key = "sk-" + "ant-api03-" + body(48);
    const result = scan({
      ".env.example": `ANTHROPIC_${"API_KEY"}=${key}\n`,
      "node_modules/pkg/index.js": `const k = "${key}";\n`,
      "dist/worker.js": `const k = "${key}";\n`,
      "pnpm-lock.yaml": `integrity: ${key}\n`,
      "logo.png": Buffer.concat([Buffer.from([0]), Buffer.from(key)]),
    });
    expect(result.status, result.output).toBe(0);
  });
});
