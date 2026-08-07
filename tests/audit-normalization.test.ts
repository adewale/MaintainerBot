import { describe, expect, it } from "vitest";
import { normalizeStoredProjectAudit } from "../src/maintenance/daily.ts";

const project = {
  repo: "adewale/trusted",
  stateFingerprint: "state",
  inputHash: "input",
  rebuiltThisRun: false,
  url: "https://github.com/adewale/trusted",
  description: null,
  language: "TypeScript",
  lastPushed: "2026-01-01T00:00:00.000Z",
  health: {
    hasReadme: true,
    hasLicense: true,
    hasCi: true,
    hasPackageJson: true,
    hasTests: true,
    hasLockfile: true,
    packageManager: "pnpm",
  },
  openTodos: [],
  openIssues: [],
  openPullRequests: [],
  deterministicFindings: [],
};

describe("normalizeStoredProjectAudit()", () => {
  it("overwrites historical model-provided repository provenance", () => {
    const audit = normalizeStoredProjectAudit(
      {
        repo: "attacker/untrusted",
        auditedAt: "2026-01-02T00:00:00.000Z",
        inputHash: "input",
        promptVersion: "old",
        model: "anthropic/test",
        status: "healthy",
        summary: "summary",
        recommendations: [
          {
            fingerprint: "attacker/untrusted:fake",
            repo: "attacker/untrusted",
            priority: "P3",
            category: "investigation",
            title: "Investigate",
            evidence: [],
            recommendedAction: "Inspect",
            reason: "Reason",
            verification: "Verify",
            risk: "low",
          },
        ],
        sharedLessons: [],
      },
      project,
      "2026-01-03T00:00:00.000Z",
    );

    expect(audit?.repo).toBe("adewale/trusted");
    expect(audit?.recommendations).toEqual([
      expect.objectContaining({
        repo: "adewale/trusted",
        fingerprint: "adewale/trusted:llm:investigate",
      }),
    ]);
  });

  it("rejects malformed persisted audit data", () => {
    expect(
      normalizeStoredProjectAudit(
        { status: "healthy" },
        project,
        "2026-01-03T00:00:00.000Z",
      ),
    ).toBeNull();
  });
});
