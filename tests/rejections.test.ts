import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDeterministicReport,
  rejectedFingerprints,
} from "../src/maintenance/daily.ts";

type Repos = Parameters<typeof buildDeterministicReport>[0];

const repos: Repos = [
  {
    name: "bravo",
    fullName: "adewale/bravo",
    url: "https://github.com/adewale/bravo",
    description: null,
    openIssues: 0,
    stars: 0,
    pushedAt: "2026-08-20T00:00:00Z",
    language: "TypeScript",
    defaultBranch: "main",
    health: {
      hasReadme: false,
      hasLicense: true,
      hasCi: false,
      hasPackageJson: true,
      hasTests: true,
      hasLockfile: true,
      packageManager: "pnpm",
    },
    openTodos: [],
  },
];

const README_FINGERPRINT =
  "adewale/bravo:missing-readme:add-readme-documentation";
const DESCRIPTION_FINGERPRINT =
  "adewale/bravo:metadata-description:add-or-improve-project-description-documentation";
const CI_FINGERPRINT = "adewale/bravo:missing-ci:add-basic-ci-checks";

describe("rejectedFingerprints()", () => {
  it("reads fingerprints from the rejections ledger format", () => {
    const ledger = JSON.stringify({
      version: 1,
      rejected: [
        { fingerprint: README_FINGERPRINT, reason: "no" },
        { fingerprint: CI_FINGERPRINT, reason: "no" },
      ],
    });
    expect(rejectedFingerprints(ledger)).toEqual(
      new Set([README_FINGERPRINT, CI_FINGERPRINT]),
    );
  });

  it("treats the committed ledger's examples as documentation, not rejections", () => {
    const committed = readFileSync(
      new URL("../data/rejections.json", import.meta.url),
      "utf8",
    );
    expect(JSON.parse(committed).examples.length).toBeGreaterThan(0);
    expect(rejectedFingerprints(committed)).toEqual(new Set());
  });

  it("fails open to no rejections on unreadable input", () => {
    expect(rejectedFingerprints("not json")).toEqual(new Set());
    expect(rejectedFingerprints(JSON.stringify({ version: 1 }))).toEqual(
      new Set(),
    );
  });
});

describe("buildDeterministicReport() rejection filtering", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-01T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("drops rejected fingerprints from recommendations and draft candidates", () => {
    const unfiltered = buildDeterministicReport(repos, [], [], new Set());
    expect(unfiltered.recommendations.map((item) => item.fingerprint)).toEqual([
      DESCRIPTION_FINGERPRINT,
      README_FINGERPRINT,
      CI_FINGERPRINT,
    ]);

    const report = buildDeterministicReport(
      repos,
      [],
      [],
      new Set([README_FINGERPRINT, CI_FINGERPRINT]),
    );
    expect(report.recommendations.map((item) => item.fingerprint)).toEqual([
      DESCRIPTION_FINGERPRINT,
    ]);
    expect(report.draftPrCandidates.map((item) => item.fingerprint)).toEqual([
      DESCRIPTION_FINGERPRINT,
    ]);
  });

  it("ignores rejections for fingerprints the scan did not produce", () => {
    const report = buildDeterministicReport(
      repos,
      [],
      [],
      new Set(["adewale/other:missing-ci:add-basic-ci-checks"]),
    );
    expect(report.recommendations).toHaveLength(3);
  });
});
