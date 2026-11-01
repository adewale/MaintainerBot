import { afterEach, describe, expect, it, vi } from "vitest";
import { init } from "@flue/runtime";
import { runDailyMaintenance } from "../src/maintenance/daily.ts";

vi.mock("@flue/runtime", () => ({ init: vi.fn() }));
vi.mock("../src/agents/report-analyst.ts", () => ({ ReportAnalyst: () => null }));

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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("persisted project audit prompt versions", () => {
  it.each(["project-audit-v2", undefined])("refreshes a %s audit once, then reuses the current-policy audit", async (promptVersion) => {
    const repo = "adewale/example";
    const bucket = new MemoryBucket();
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input instanceof Request ? input.url : input)).pathname;
      if (path === "/users/adewale/repos") return Response.json([{
        name: "example", full_name: repo,
        html_url: `https://github.com/${repo}`, description: "Example",
        open_issues_count: 0, stargazers_count: 0,
        pushed_at: "2026-10-01T00:00:00Z", language: "Markdown",
        default_branch: "main", fork: false, archived: false,
      }]);
      if (path === "/search/issues") return Response.json({ items: [] });
      if (path === `/repos/${repo}/contents`) {
        return Response.json([{ name: "README.md" }, { name: "LICENSE" }]);
      }
      return Response.json({ message: "Not Found" }, { status: 404 });
    }));

    const env = { GITHUB_OWNER: "adewale", MAINTAINERBOT_R2: bucket };
    const run = { generatedAt: "2026-11-01T00:00:00.000Z", runId: "policy-test" };
    // Warm the cached context so only the prompt version changes below.
    await runDailyMaintenance(env, run);
    await runDailyMaintenance(env, run);
    const context = JSON.parse(bucket.objects.get("contexts/projects/adewale__example/latest.json")!);
    const auditKey = "audits/projects/adewale__example/latest.json";
    bucket.objects.set(auditKey, JSON.stringify({
      inputHash: context.inputHash, promptVersion,
      status: "healthy", summary: "Old policy", recommendations: [], sharedLessons: [],
    }));

    const calls: string[] = [];
    vi.mocked(init).mockReturnValue({
      dispatch: async (request: { initialData: { kind: string } }) => {
        calls.push(request.initialData.kind);
        return request.initialData.kind;
      },
      read: async (kind: string) => ({ data: { "analysis-result": [
        kind === "project-audit"
          ? { kind, status: "healthy", summary: "No supported action", recommendations: [], sharedLessons: [] }
          : { kind, summary: "No supported action", priorityActions: [], draftPrCandidates: [], projectRecommendations: [], sharedLessons: [] },
      ] } }),
    } as unknown as ReturnType<typeof init>);

    const modelEnv = { ...env, OPENAI_API_KEY: "test-only-not-a-real-key" };
    const refreshed = await runDailyMaintenance(modelEnv, run);
    expect(calls).toEqual(["project-audit", "run-synthesis"]);
    expect(refreshed.llmAudits.audited).toEqual([repo]);
    expect(JSON.parse(bucket.objects.get(auditKey)!).promptVersion).toBe("project-audit-v3");
    expect(refreshed.draftPrCandidates).toEqual([]);

    calls.length = 0;
    const reused = await runDailyMaintenance(modelEnv, run);
    expect(calls).toEqual(["run-synthesis"]);
    expect(reused.llmAudits.carriedForward).toEqual([repo]);
  });
});
