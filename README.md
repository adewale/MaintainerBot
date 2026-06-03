# MaintainerBot

MaintainerBot is a read-only Flue maintenance bot for my public open-source projects. It runs daily, gathers deterministic GitHub/project facts, stores replayable context bundles in R2, and publishes an action-first handoff page.

If you are reading this from the “Learning Flue in 3 bots” thread, this is the third bot: a deployed, stateful Cloudflare/R2 example that is more realistic than a gist.

## Best links

- **Live status page:** https://maintainerbot-status.adewale-883.workers.dev/
- **Raw Markdown output:** https://pub-39149b57d8394ddea78c0ca9f90e087f.r2.dev/MaintainerBotOut.md
- **JSON output:** https://maintainerbot-status.adewale-883.workers.dev/json
- **Main workflow:** [`.flue/workflows/daily-maintenance.ts`](.flue/workflows/daily-maintenance.ts)
- **Living spec:** [`docs/LIVING_SPEC.md`](docs/LIVING_SPEC.md)
- **Context model:** [`docs/CONTEXT.md`](docs/CONTEXT.md)
- **Lessons learned:** [`docs/LESSONS_LEARNED.md`](docs/LESSONS_LEARNED.md)

## What it does

MaintainerBot scans repositories changed since **November 17, 2025** and reports:

- open issues needing triage
- open PRs needing review
- root TODO files
- repo health signals: README, license, CI, package files, lockfiles, test/check scripts
- deterministic recommendations with stable fingerprints
- context bundle reuse/rebuild status
- previous audit state when available

It is intentionally **read-only**. It does not create branches, commits, PRs, comments, labels, issues, releases, or repository setting changes.

## Why it exists

This project is both useful tooling and a Flue learning artifact. It explores how to build a hosted maintenance agent that separates:

```txt
deterministic facts → durable context bundle → bounded LLM step → published handoff
```

The important design idea is replay: a stored context bundle can be re-evaluated later by another prompt/model/agent without hitting GitHub again.

## Current status

The deployed bot currently runs in:

```txt
context-only-no-model
```

That means no LLM provider key is configured in Cloudflare yet. The bot still builds/reuses context bundles and emits deterministic surface-audit facts. When an LLM key is configured, it will additionally run changed-project audits and synthesize the final handoff.

## How it works

```txt
Daily GitHub Actions schedule
  → protected Cloudflare Worker webhook
  → read GitHub + R2 facts
  → compute cheap project fingerprints
  → reuse unchanged project context bundles
  → rebuild changed project context bundles
  → optional LLM project audits
  → optional LLM run synthesis
  → write Markdown/JSON/status/context/audit artifacts to R2
```

Durable R2 objects include:

```txt
MaintainerBotOut.md
MaintainerBotOut.json
contexts/index.json
contexts/runs/<runId>.json
contexts/projects/<owner>__<repo>/latest.json
audits/projects/<owner>__<repo>/latest.json
reports/history/YYYY-MM-DD/daily-maintenance.md
reports/history/YYYY-MM-DD/daily-maintenance.json
```

## Run locally

```bash
pnpm install
cp .env.example .env
pnpm run save:daily
```

Primary local output:

```txt
/tmp/MaintainerBotOut.md
```

## Configuration

Useful `.env` values:

```bash
GITHUB_OWNER=adewale
# Optional: set GITHUB_TOKEN in .env for higher GitHub API limits.
FLUE_MODEL=anthropic/claude-haiku-4-5
ANTHROPIC_API_KEY=your-anthropic-key
# or OPENAI_API_KEY / OPENROUTER_API_KEY
```

A GitHub token is optional but recommended in production to avoid unauthenticated API rate limits. Use a read-only/least-privileged token.

An LLM key is optional. Without it, MaintainerBot emits a degraded context-only report. With it, MaintainerBot emits LLM-synthesized recommendations.

## Deploy

Create the R2 bucket once:

```bash
pnpm exec wrangler r2 bucket create maintainerbot-data
```

Set secrets:

```bash
pnpm exec wrangler secret put MAINTAINERBOT_WEBHOOK_SECRET
pnpm exec wrangler secret put GITHUB_TOKEN
pnpm exec wrangler secret put ANTHROPIC_API_KEY # or OPENAI_API_KEY / OPENROUTER_API_KEY
```

Deploy the main Worker:

```bash
pnpm run deploy:cloudflare
```

Deploy the status Worker:

```bash
pnpm run deploy:status
```

Invoke manually:

```bash
curl -X POST https://maintainerbot.<your-subdomain>.workers.dev/agents/daily-maintenance/daily \
  -H 'Content-Type: application/json' \
  -d '{"webhookSecret":"..."}'
```

## Safety model

- public source contains no secrets
- webhook requires `MAINTAINERBOT_WEBHOOK_SECRET`
- GitHub access should be read-only
- all durable bot state lives in R2
- LLM context never includes secrets
- recommendations are human handoff only

Before pushing:

```bash
pnpm run check:secrets
pnpm run test:rejections
pnpm run build:cloudflare
```

## Project map

```txt
.flue/workflows/daily-maintenance.ts main hosted Flue workflow
.flue/workflows/deep-verify.ts       CLI-only future verifier scaffold
workers/status.ts                    pretty status-page Worker
docs/LIVING_SPEC.md                  concise intent
docs/CONTEXT.md                      replayable context bundle model
docs/LESSONS_LEARNED.md              design lessons
docs/OPERATIONS.md                   operating notes
SPEC.md                              implementation contract
TODO.md                              remaining work
```

## For the tweet

Best place to point people:

```txt
https://github.com/adewale/MaintainerBot
```

Best place to show the live bot output:

```txt
https://maintainerbot-status.adewale-883.workers.dev/
```
