/**
 * Golden tests for the deterministic (no-LLM) daily pipeline.
 *
 * `runDailyMaintenance` runs against stubbed GitHub API responses and an
 * in-memory R2 bucket, with no model credentials, so every stage is
 * deterministic: repo/issue/PR fetches, health and TODO scans, rejection
 * filtering, project context bundles, the run context bundle, the report and
 * its Markdown.
 *
 * The run context bundle it stores is compared with
 * tests/fixtures/golden-run-context.json. That fixture is also replayed through
 * the deterministic stage on its own, the same way a stored bundle is replayed
 * from R2. If the pipeline changes on purpose, regenerate the fixture with
 * `UPDATE_GOLDEN=1 pnpm exec vitest run tests/daily-pipeline.golden.test.ts`
 * and review the diff.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDeterministicReport,
  renderMarkdown,
  runDailyMaintenance,
} from "../src/maintenance/daily.ts";

const GENERATED_AT = "2026-09-01T12:00:00.000Z";
const RUN_ID = "golden-run";
const GOLDEN = new URL("./fixtures/golden-run-context.json", import.meta.url);
const REJECTED_CI = "adewale/bravo:missing-ci:add-basic-ci-checks";

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

const repos = [
  {
    name: "alpha",
    full_name: "adewale/alpha",
    html_url: "https://github.com/adewale/alpha",
    description: "A healthy TypeScript project",
    open_issues_count: 1,
    stargazers_count: 5,
    pushed_at: "2026-08-30T10:00:00Z",
    language: "TypeScript",
    default_branch: "main",
    fork: false,
    archived: false,
  },
  {
    name: "bravo",
    full_name: "adewale/bravo",
    html_url: "https://github.com/adewale/bravo",
    description: null,
    open_issues_count: 1,
    stargazers_count: 0,
    pushed_at: "2026-08-20T10:00:00Z",
    language: "JavaScript",
    default_branch: "main",
    fork: false,
    archived: false,
  },
  {
    name: "charlie",
    full_name: "adewale/charlie",
    html_url: "https://github.com/adewale/charlie",
    description: "A Python library",
    open_issues_count: 1,
    stargazers_count: 2,
    pushed_at: "2025-12-01T10:00:00Z",
    language: "Python",
    default_branch: "main",
    fork: false,
    archived: false,
  },
  // Filtered out before any per-repo work: a fork, and a repo older than the cutoff.
  {
    name: "forked",
    full_name: "adewale/forked",
    html_url: "https://github.com/adewale/forked",
    description: "fork",
    open_issues_count: 0,
    stargazers_count: 0,
    pushed_at: "2026-08-30T10:00:00Z",
    language: "Go",
    default_branch: "main",
    fork: true,
    archived: false,
  },
  {
    name: "ancient",
    full_name: "adewale/ancient",
    html_url: "https://github.com/adewale/ancient",
    description: "old",
    open_issues_count: 1,
    stargazers_count: 0,
    pushed_at: "2025-01-01T10:00:00Z",
    language: "Go",
    default_branch: "main",
    fork: false,
    archived: false,
  },
];

const searchItem = (
  repo: string,
  number: number,
  title: string,
  createdAt: string,
  updatedAt: string,
  labels: string[] = [],
) => ({
  repository_url: `https://api.github.com/repos/${repo}`,
  number,
  title,
  html_url: `https://github.com/${repo}/issues/${number}`,
  state: "open",
  created_at: createdAt,
  updated_at: updatedAt,
  labels: labels.map((name) => ({ name })),
  comments: 1,
  user: { login: "someone" },
});

const issues = [
  searchItem(
    "adewale/bravo",
    3,
    "Credential pattern missing from scanner",
    "2026-08-25T00:00:00Z",
    "2026-08-28T00:00:00Z",
    ["security"],
  ),
  searchItem(
    "adewale/charlie",
    7,
    "Docs typo",
    "2026-05-01T00:00:00Z",
    "2026-05-02T00:00:00Z",
  ),
  searchItem(
    "adewale/ancient",
    1,
    "Should be filtered with its repo",
    "2026-08-01T00:00:00Z",
    "2026-08-01T00:00:00Z",
  ),
];

const pullRequests = [
  searchItem(
    "adewale/alpha",
    12,
    "Add caching layer",
    "2026-06-20T00:00:00Z",
    "2026-08-15T00:00:00Z",
  ),
];

const files = (...names: string[]) => names.map((name) => ({ name }));
const contents: Record<string, unknown> = {
  "adewale/alpha/contents": files(
    "README.md",
    "LICENSE",
    "package.json",
    "pnpm-lock.yaml",
    ".github",
  ),
  "adewale/alpha/contents/.github/workflows": files("ci.yml"),
  "adewale/alpha/contents/package.json": {
    content: b64(JSON.stringify({ scripts: { test: "vitest run" } })),
  },
  "adewale/alpha/contents/TODO.md": {
    content: b64("# TODO\n\n- [ ] Document the cache\n- [x] Ship v1\nnot a todo\n"),
  },
  "adewale/bravo/contents": files("README.md", "package.json"),
  "adewale/bravo/contents/package.json": {
    content: b64(JSON.stringify({ scripts: { build: "tsc" } })),
  },
  "adewale/charlie/contents": files("LICENSE", "pyproject.toml"),
};

function githubStub(url: string): Response {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  const parsed = new URL(url);
  if (parsed.pathname === "/users/adewale/repos") return json(repos);
  if (parsed.pathname === "/search/issues") {
    const query = parsed.searchParams.get("q") ?? "";
    if (query === "user:adewale is:issue is:open") return json({ items: issues });
    if (query === "user:adewale is:pr is:open") return json({ items: pullRequests });
  }
  const match = parsed.pathname.match(/^\/repos\/(.+)$/);
  if (match && match[1] in contents) return json(contents[match[1]]);
  return json({ message: "Not Found" }, 404);
}

class MemoryBucket {
  objects = new Map<string, string>();
  async get(key: string) {
    const value = this.objects.get(key);
    return value === undefined ? null : { text: async () => value };
  }
  async put(key: string, value: string) {
    this.objects.set(key, value);
  }
}

async function runGolden() {
  const bucket = new MemoryBucket();
  bucket.objects.set(
    "data/rejections.json",
    JSON.stringify({ version: 1, rejected: [{ fingerprint: REJECTED_CI }] }),
  );
  const report = await runDailyMaintenance(
    { GITHUB_OWNER: "adewale", MAINTAINERBOT_R2: bucket },
    { runId: RUN_ID, generatedAt: GENERATED_AT },
  );
  return { bucket, report };
}

describe("daily pipeline golden run (no LLM)", () => {
  const fetchStub = vi.fn(async (input: string | URL | Request) =>
    githubStub(String(input instanceof Request ? input.url : input)),
  );

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(GENERATED_AT));
    vi.stubGlobal("fetch", fetchStub);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    fetchStub.mockClear();
  });

  it("produces the expected findings and filters rejected fingerprints", async () => {
    const { report } = await runGolden();

    expect(report.mode).toBe("context-only-no-model");
    expect(report.model).toBe("none");
    expect(report.repoCount).toBe(3);
    expect(report.recommendations.map((item) => item.fingerprint)).toEqual([
      "adewale/bravo:metadata-description:add-or-improve-project-description-documentation",
      "adewale/charlie:missing-readme:add-readme-documentation",
      "adewale/bravo:missing-test-script:add-or-document-test-command",
      "adewale/charlie:stale-repo-review:review-stale-repository-status",
    ]);
    expect(report.recommendations.map((item) => item.fingerprint)).not.toContain(
      REJECTED_CI,
    );
    expect(report.draftPrCandidates).toEqual([]);
    expect(report.createdDraftPrs).toEqual([]);

    expect(report.issues.map((item) => `${item.repo}#${item.number}`)).toEqual([
      "adewale/bravo#3",
      "adewale/charlie#7",
    ]);
    expect(report.priorityActions).toEqual([
      "[P0] Triage issue adewale/bravo#3: Credential pattern missing from scanner",
      "[P2] Triage issue adewale/charlie#7: Docs typo",
      "[P1] Review PR adewale/alpha#12: Add caching layer",
    ]);

    expect(report.contextSummary.healthGaps).toEqual({
      missingDescription: ["adewale/bravo"],
      missingLicense: ["adewale/bravo"],
      missingCi: ["adewale/bravo"],
      missingTests: ["adewale/bravo"],
    });
    expect(report.contextSummary.projectsWithTodos).toEqual([
      { repo: "adewale/alpha", todos: ["- [ ] Document the cache"] },
    ]);
    expect(report.contextSummary.rebuiltContextBundles).toEqual([
      "adewale/alpha",
      "adewale/bravo",
      "adewale/charlie",
    ]);
  });

  it("stores the report and context bundles in R2 and renders the handoff", async () => {
    const { bucket, report } = await runGolden();

    expect(report.r2?.keys).toContain("reports/daily-maintenance-latest.json");
    for (const key of [
      "MaintainerBotOut.md",
      "reports/daily-maintenance-latest.md",
      `reports/history/2026-09-01/${RUN_ID}/daily-maintenance.json`,
      "contexts/index.json",
      `contexts/runs/${RUN_ID}.json`,
      "contexts/projects/adewale__alpha/latest.json",
      `contexts/projects/adewale__charlie/history/${RUN_ID}.json`,
    ]) {
      expect(bucket.objects.has(key), key).toBe(true);
    }

    const markdown = bucket.objects.get("MaintainerBotOut.md") ?? "";
    expect(markdown).toBe(renderMarkdown(report));
    const headings = markdown
      .split("\n")
      .filter((line) => /^##? /.test(line));
    expect(headings).toEqual([
      "# MaintainerBot Status",
      "## Action inbox",
      "## Loaded context",
      "## LLM audit status",
      "## Manual action candidates",
      "## Open PRs needing review",
      "## Open issues needing triage",
      "## Repo health fixes",
      "## Summary",
      "## Read-only mutation status",
      "## Shared lessons",
    ]);
    expect(markdown).toContain("**LLM not configured.**");
    expect(markdown).toContain(
      "1. [P0] Triage issue [adewale/bravo#3](https://github.com/adewale/bravo/issues/3)",
    );
  });

  it("stores a run context bundle that matches the golden fixture", async () => {
    const { bucket } = await runGolden();
    const stored = JSON.parse(bucket.objects.get(`contexts/runs/${RUN_ID}.json`) ?? "null");

    if (process.env.UPDATE_GOLDEN) {
      writeFileSync(GOLDEN, `${JSON.stringify(stored, null, 2)}\n`);
    }
    const golden = JSON.parse(readFileSync(GOLDEN, "utf8"));
    expect(stored).toEqual(golden);
  });

  it("replays the stored bundle through the deterministic stage without GitHub", () => {
    const bundle = JSON.parse(readFileSync(GOLDEN, "utf8"));
    const snapshot = bundle.deterministicSnapshot;
    expect(bundle.kind).toBe("maintainerbot.run-context");
    expect(snapshot.repos).toHaveLength(3);

    const replayed = buildDeterministicReport(
      snapshot.repos,
      snapshot.openIssues,
      snapshot.openPullRequests,
      new Set([REJECTED_CI]),
    );
    expect(replayed.recommendations).toEqual(snapshot.deterministicRecommendations);
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
