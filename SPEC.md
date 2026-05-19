# MaintainerBot Spec

MaintainerBot is a read-only daily maintenance handoff for Adewale's public open-source projects.

The concise evolving spec is `docs/LIVING_SPEC.md`. This file records the current implementation contract.

## Goals

- Only consider repositories changed since `2025-11-17T00:00:00.000Z`.
- Gather deterministic GitHub/R2 facts before calling the LLM.
- Use project state fingerprints to skip unchanged project context rebuilds.
- Store durable context bundles and audit outputs in R2 for replay.
- Call an LLM on every successful invocation to synthesize the daily handoff.
- Publish an action-first living status page.
- Never mutate GitHub.

## Non-goals for Phase 1

- No repo checkout.
- No tests/builds/evals.
- No coding-agent edits.
- No branches, commits, PRs, comments, labels, issue edits, releases, or settings changes.
- No email dependency.

Later phases may add read-only checkout/eval/coding-agent workflows, but those produce evidence artifacts only.

## Runtime

Main agent:

```txt
.flue/agents/daily-maintenance.ts
```

Public status Worker:

```txt
workers/status.ts
wrangler.status.jsonc
```

Primary URLs:

```txt
https://maintainerbot-status.adewale-883.workers.dev
https://pub-39149b57d8394ddea78c0ca9f90e087f.r2.dev/MaintainerBotOut.md
```

## Required configuration

```txt
MAINTAINERBOT_WEBHOOK_SECRET  # protects webhook
ANTHROPIC_API_KEY | OPENAI_API_KEY | OPENROUTER_API_KEY
```

Optional:

```txt
GITHUB_TOKEN                  # read-only preferred, for rate limits/private visibility
FLUE_MODEL                    # defaults based on configured provider
CLOUDFLARE_ACCOUNT_ID         # optional AI Gateway
CF_AI_GATEWAY_ID
CF_AI_GATEWAY_TOKEN
```

## Daily workflow

```txt
GitHub Actions or manual caller
  → POST protected webhook
  → load R2 memory/indexes
  → fetch cheap repo/issue/PR facts
  → filter repos changed since 2025-11-17
  → compute project state fingerprints
  → reuse unchanged project context bundles
  → rebuild changed project context bundles
  → run per-project LLM audits for changed contexts
  → build run context bundle
  → run LLM synthesis for final handoff
  → write reports/context/audits to R2
```

## Deterministic facts

For each eligible project, MaintainerBot may gather:

- repo metadata: name, URL, description, language, default branch, `pushed_at`
- repo health: README, LICENSE, CI workflows, package file, lockfile, test/check script
- root TODOs from `TODO.md`, `TODOS.md`, `todo.md`, `todo.txt`
- open issues
- open PRs
- deterministic recommendations
- rejection fingerprints
- lessons ledger

The LLM receives only normalized facts/context bundles, never secrets.

## Context and replay

Context bundles are durable LLM inputs. Re-running the bot is not the same as replaying an old decision point; replay uses the stored bundle.

R2 layout:

```txt
contexts/index.json
contexts/runs/<runId>.json
contexts/projects/<owner>__<repo>/latest.json
contexts/projects/<owner>__<repo>/history/<runId>.json
audits/index.json
audits/projects/<owner>__<repo>/latest.json
audits/projects/<owner>__<repo>/history/<runId>.json
```

See `docs/CONTEXT.md` for type signatures.

## LLM contract

Per-project audit:

```ts
auditProjectWithLlm(session, projectContextBundle): Promise<ProjectAudit>
```

Run synthesis:

```ts
synthesizeRunWithLlm(session, runContextBundle): Promise<MaintenanceReport>
```

Rules:

- Use only supplied bundle facts.
- Do not invent repos, files, issues, PRs, TODOs, CI results, code behavior, or verification results.
- If evidence is weak, recommend investigation.
- Emit stable fingerprints.
- Avoid rejected fingerprints.
- Do not claim GitHub state changed.

## R2 report objects

```txt
MaintainerBotOut.md
MaintainerBotOut.json
reports/daily-maintenance-latest.md
reports/daily-maintenance-latest.json
reports/history/YYYY-MM-DD/daily-maintenance.md
reports/history/YYYY-MM-DD/daily-maintenance.json
```

## Safety

- The webhook requires `MAINTAINERBOT_WEBHOOK_SECRET` when configured.
- Use least-privilege/read-only GitHub tokens.
- Durable data is in R2.
- Public source must contain no secrets.
- Run `pnpm run check:secrets` before pushing.
- MaintainerBot writes only its own R2 objects.

## Local commands

```bash
pnpm install
pnpm run build:cloudflare
pnpm run check:secrets
pnpm run test:rejections
pnpm run deploy:cloudflare
pnpm run deploy:status
```

## Deferred work

Canonical checklist:

```txt
TODO.md
```
