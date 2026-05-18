# MaintainerBot Context Model

MaintainerBot treats context as a first-class artifact, not an ad-hoc prompt string.

## Workflow

```txt
Daily cron/webhook
  → load durable memory and previous context index from R2
  → run cheap deterministic discovery loaders
  → compute one project state fingerprint per eligible repo
  → compare project state fingerprints with previous context index
  → reuse previous project context bundles for unchanged projects
  → build fresh project context bundles only for changed projects
  → call LLM only for changed project bundles
  → store new project context bundles and LLM audit outputs in R2
  → build one account-level run context bundle from refs + latest audits
  → call LLM once for run-level synthesis
  → store living status page, run context, and JSON in R2
```

This allows local replay:

```txt
R2 stored context bundle → local/dev LLM or alternate agent → compare outputs
```

It also allows multiple agents/models to evaluate the same immutable-ish context bundle without re-running GitHub/API loaders.

## Granularity

MaintainerBot uses two context granularities:

1. **Run context bundle**: account-level snapshot for one invocation.
2. **Project context bundle**: repo-level snapshot used for per-project LLM audits and replay.

The project state fingerprint is the cheapest cache key. If it has not changed, MaintainerBot does not rebuild that project's full context bundle; it reuses the previous `latest.json` context bundle and carries forward the previous project audit. The project context bundle is rebuilt only after cheap discovery says the project changed. The current implementation stores `contexts/index.json`, stores project context bundles only when rebuilt, and writes each run's context refs to `contexts/runs/<runId>.json`.

Cheap discovery should avoid expensive/full context work. It can use signals such as:

- repo `pushed_at`, description, default branch, language, archived/fork flags
- open issue numbers and `updated_at`
- open PR numbers and `updated_at`
- root TODO file content SHA/ETag from GitHub contents metadata
- key health file SHAs/existence: README, LICENSE, workflows, package file, lockfile
- lessons/rejections version or hash when those should invalidate recommendations

The full project context bundle includes richer normalized facts and is what gets injected into per-project LLM audits.

## Context bundle signature

```ts
type MaintainerBotRunContextBundle = {
  schemaVersion: 1;
  kind: 'maintainerbot.run-context';
  runId: string;
  generatedAt: string;
  owner: string;
  cutoff: '2025-11-17T00:00:00.000Z';
  source: {
    trigger: 'daily-cron' | 'manual' | 'local-replay';
    environment: 'cloudflare-worker' | 'node-cli' | 'github-actions';
  };
  durableMemory: {
    lessons: string;
    rejectedFingerprints: string[];
    previousContextIndex: Record<string, PreviousProjectContextSummary>;
    previousAuditIndex: Record<string, PreviousProjectAuditSummary>;
  };
  deterministicSnapshot: {
    repos: RepoSummary[];
    openIssues: WorkItem[];
    openPullRequests: WorkItem[];
    deterministicRecommendations: Recommendation[];
  };
  projectBundles: ProjectContextBundleRef[];
  latestProjectAudits: ProjectAudit[];
};

type ProjectContextBundleRef = {
  repo: string;
  stateFingerprint: string;
  inputHash: string;
  r2Key: string;
  rebuiltThisRun: boolean;
  changedSinceLastAudit: boolean;
  latestAuditKey?: string;
};

type ProjectStateFingerprintInput = {
  repo: string;
  pushedAt: string | null;
  repoMetadataHash: string;
  issueUpdateHash: string;
  prUpdateHash: string;
  todoMetadataHash: string;
  healthMetadataHash: string;
  memoryHash: string;
};

type ProjectContextBundle = {
  schemaVersion: 1;
  kind: 'maintainerbot.project-context';
  repo: string;
  generatedAt: string;
  stateFingerprint: string;
  inputHash: string;
  cutoff: '2025-11-17T00:00:00.000Z';
  metadata: {
    url: string;
    description: string | null;
    language: string | null;
    lastPushed: string | null;
    defaultBranch: string;
  };
  deterministicFacts: {
    health: RepoHealth;
    openTodos: string[];
    openIssues: WorkItem[];
    openPullRequests: WorkItem[];
    deterministicFindings: Recommendation[];
  };
  durableMemory: {
    rejectedFingerprints: string[];
    lessons: string;
    previousAudit?: ProjectAudit;
  };
  provenance: {
    loaders: string[];
    fetchedAt: string;
    githubOwner: string;
  };
};
```

## LLM injection signature

Per-project audit:

```ts
async function auditProjectWithLlm(
  session: FlueSession,
  bundle: ProjectContextBundle,
): Promise<ProjectAudit>;
```

Prompt contract:

```txt
You are auditing one repository from a stored MaintainerBot project context bundle.
Use only this JSON bundle. Do not invent files, issues, PRs, TODOs, CI results, code behavior, or verification results.
MaintainerBot is read-only. Recommend human actions only.
```

Run-level synthesis:

```ts
async function synthesizeRunWithLlm(
  session: FlueSession,
  bundle: MaintainerBotRunContextBundle,
): Promise<MaintenanceReport>;
```

Prompt contract:

```txt
You are synthesizing the daily MaintainerBot handoff from a stored run context bundle.
Use deterministic facts and latest project audits only. Rank actions by evidence, urgency, and likely impact.
Do not claim GitHub state changed.
```

## R2 layout

```txt
contexts/index.json
contexts/runs/<runId>.json
contexts/projects/<owner>__<repo>/latest.json
contexts/projects/<owner>__<repo>/history/<runId>.json
audits/projects/<owner>__<repo>/latest.json
audits/projects/<owner>__<repo>/history/<runId>.json
audits/index.json
```
