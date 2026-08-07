# MaintainerBot Context Bundles

MaintainerBot stores the exact evidence given to the LLM so audits are replayable.

## Workflow

```txt
Daily trigger
  → fetch cheap repo/issue/PR facts
  → compute project state fingerprints
  → reuse unchanged project context bundles from R2
  → rebuild changed project context bundles
  → LLM-audit changed project bundles
  → build run context bundle from bundle refs + latest audits
  → LLM-synthesize daily handoff
  → write status/report/context/audit artifacts to R2
```

## R2 layout

```txt
contexts/index.json
contexts/runs/<runId>.json
contexts/projects/<owner>__<repo>/latest.json
contexts/projects/<owner>__<repo>/history/<runId>.json
audits/index.json
audits/projects/<owner>__<repo>/latest.json
audits/projects/<owner>__<repo>/history/<runId>.json
```

`latest.json` is mutable convenience. `history/*` is the replay source.

## Project state fingerprint

A cheap cache key used before full context construction:

```ts
type ProjectStateFingerprintInput = {
  repo: string;
  pushedAt: string | null;
  repoMetadataHash: string;
  issueUpdateHash: string;
  prUpdateHash: string;
  memoryHash: string;
};
```

If unchanged, MaintainerBot reuses the previous project context bundle and previous project audit.

## Project context bundle

```ts
type ProjectContextBundle = {
  schemaVersion: 1;
  kind: 'maintainerbot.project-context';
  repo: string;
  generatedAt: string;
  stateFingerprint: string;
  inputHash: string;
  rebuiltThisRun: boolean;
  metadata: {
    url: string;
    description: string | null;
    language: string | null;
    lastPushed: string | null;
    defaultBranch: string;
  };
  facts: {
    health: RepoHealth;
    openTodos: string[];
    openIssues: WorkItem[];
    openPullRequests: WorkItem[];
    deterministicFindings: Recommendation[];
  };
};
```

## Run context bundle

```ts
type MaintainerBotRunContextBundle = {
  schemaVersion: 1;
  kind: 'maintainerbot.run-context';
  runId: string;
  generatedAt: string;
  owner: string;
  cutoff: '2025-11-17T00:00:00.000Z';
  promptVersion: string;
  model: string;
  deterministicSnapshot: {
    repos: RepoSummary[];
    openIssues: WorkItem[];
    openPullRequests: WorkItem[];
    deterministicRecommendations: Recommendation[];
  };
  projectBundles: Array<{
    repo: string;
    stateFingerprint: string;
    inputHash: string;
    r2Key: string;
    rebuiltThisRun: boolean;
    latestAuditKey?: string;
  }>;
  latestProjectAudits: ProjectAudit[];
};
```

## Flue 2 analysis contract

Trusted application code dispatches the private `ReportAnalyst` agent with normalized evidence. The hooks-based agent must call `submit_analysis_result`; `useDataWriter('analysis-result', …)` records a schema-validated project-audit or run-synthesis value in `AgentReply.data`. Trusted code validates that value again and adds repository/run metadata before writing R2.

LLM rule: use only the supplied bundle. If evidence is missing, recommend investigation rather than inventing facts. Secrets and platform bindings are never included in agent initial data or messages.
