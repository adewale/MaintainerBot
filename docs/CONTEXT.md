# MaintainerBot Context Model

MaintainerBot treats context as a first-class artifact, not an ad-hoc prompt string.

## Workflow

```txt
Daily cron/webhook
  → load durable memory from R2
  → run deterministic read-only loaders
  → build one account-level run context bundle
  → build one project context bundle per changed project
  → hash each project context bundle
  → compare hashes with previous R2 context/audit state
  → call LLM only for changed project bundles
  → store project context bundles and LLM audit outputs in R2
  → call LLM once for run-level synthesis using deterministic facts + latest project audits
  → store living status page and JSON in R2
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

The project bundle is the cache/audit unit. If its hash has not changed, MaintainerBot carries forward the previous project audit.

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
  inputHash: string;
  r2Key: string;
  changedSinceLastAudit: boolean;
  latestAuditKey?: string;
};

type ProjectContextBundle = {
  schemaVersion: 1;
  kind: 'maintainerbot.project-context';
  repo: string;
  generatedAt: string;
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
contexts/runs/<runId>.json
contexts/projects/<owner>__<repo>/latest.json
contexts/projects/<owner>__<repo>/history/<runId>.json
audits/projects/<owner>__<repo>/latest.json
audits/projects/<owner>__<repo>/history/<runId>.json
audits/index.json
```
