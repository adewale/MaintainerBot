# MaintainerBot

MaintainerBot is a Flue project for daily maintenance of Adewale's open-source projects.

This README is the top-level intent document. The evergreen detailed spec lives in:

```txt
SPEC.md
```

As the project evolves, update both this README and `SPEC.md` with the current product direction, safety constraints, operating assumptions, and lessons learned.

## Current intent

MaintainerBot should help me maintain my various open-source projects by scanning them every day and producing a useful maintenance report.

Every day it should look at:

- Issues
- Pull requests
- Best practices and lessons learned
- Efficiency opportunities
- Code quality opportunities
- Shared lessons across repositories

Eventually, MaintainerBot should:

- Identify and verify fixes
- Create safe draft PRs
- Email me a series of PRs/recommendations that fix or improve those projects
- Keep track of what I have rejected so it never repeats rejected ideas

## Current operating mode

For now, MaintainerBot is intentionally conservative:

- It scans and reports.
- It does **not** create PRs by default.
- It does **not** send email by default.
- In local mode, it emits the main human-readable report to:

```txt
/tmp/MaintainerBotOut.md
```

- It has a GitHub Actions daily schedule that invokes the protected Cloudflare webhook at 09:00 UTC.
- In Cloudflare mode, it keeps all durable data in R2:

```txt
R2 bucket: maintainerbot-data
Binding: MAINTAINERBOT_R2
```

R2 keys:

```txt
MaintainerBotOut.md              # latest living Markdown status page
MaintainerBotOut.json            # latest machine-readable status
data/rejections.json
data/lessons.md
data/created-prs.json
reports/daily-maintenance-latest.md
reports/daily-maintenance-latest.json
reports/history/YYYY-MM-DD/daily-maintenance.md
reports/history/YYYY-MM-DD/daily-maintenance.json
```

The preferred interface is now the living R2 status file, `MaintainerBotOut.md`. Each run overwrites it with the effective current status of all scanned projects while still preserving dated history under `reports/history/`.

Local copies under `reports/` are for local debugging/history only.

## Setup

```bash
cd /Users/adewale/Documents/projects/code/flue-onboarding/MaintainerBot
pnpm install
cp .env.example .env
```

Edit `.env` as needed:

```bash
GITHUB_OWNER=adewale
GITHUB_TOKEN=...
FLUE_MODEL=anthropic/claude-haiku-4-5
ANTHROPIC_API_KEY=...
CREATE_DRAFT_PRS=false
```

## Run locally

```bash
pnpm run save:daily
```

Primary output:

```txt
/tmp/MaintainerBotOut.md
```

Secondary local outputs:

```txt
reports/daily-maintenance.md
reports/daily-maintenance.json
reports/daily-maintenance-YYYY-MM-DD.md
reports/daily-maintenance-YYYY-MM-DD.json
```

Dated daily reports are intended to be committed so we keep report history. Mutable latest files and logs are ignored by git.

## Daily scheduling

The deployed bot runs daily through:

```txt
.github/workflows/daily-maintenance.yml
```

That workflow uses the GitHub repository secret:

```txt
MAINTAINERBOT_WEBHOOK_SECRET
```

## Deploy to Cloudflare

Create the R2 bucket once:

```bash
pnpm exec wrangler r2 bucket create maintainerbot-data
```

Build and deploy:

```bash
pnpm run deploy:cloudflare
```

Invoke the deployed agent with the protected webhook secret:

```bash
SECRET=$(cat .webhook-secret)
curl -X POST https://maintainerbot.<your-subdomain>.workers.dev/agents/daily-maintenance/daily \
  -H 'Content-Type: application/json' \
  -d "{\"webhookSecret\":\"$SECRET\"}"
```

Set secrets when needed:

```bash
pnpm exec wrangler secret put MAINTAINERBOT_WEBHOOK_SECRET
pnpm exec wrangler secret put GITHUB_TOKEN
pnpm exec wrangler secret put ANTHROPIC_API_KEY
```

## Safety

Draft PR creation is implemented but intentionally not enabled by default. Keep:

```bash
CREATE_DRAFT_PRS=false
```

until the scan/report loop is producing useful recommendations. To enable it later, set `CREATE_DRAFT_PRS=true`, provide a `GITHUB_TOKEN`, and set `DRAFT_PR_REPO_ALLOWLIST` to the exact repos allowed to receive draft PRs.

Rejected ideas should be tracked in:

```txt
data/rejections.json
```

Shared lessons should be tracked in:

```txt
data/lessons.md
```

## Webhook security

The Cloudflare webhook is protected by a shared secret:

```txt
MAINTAINERBOT_WEBHOOK_SECRET
```

The source code can be public because it only contains the check, not the secret value. The real secret lives in Cloudflare Worker secrets and local ignored files such as `.webhook-secret` or `.env`.

An attacker can see that a secret is required, but cannot run the job without knowing the secret value.

## Secret hygiene

Before committing or pushing, run:

```bash
pnpm run check:secrets
```

Rules:

- Never commit `.env` or `.env.*` files.
- Keep real tokens only in local env vars, GitHub Secrets, or deployment secrets.
- Commit only placeholders in `.env.example`.
- If a real secret is ever committed, rotate it immediately.

## Evolving intent log

Add notes here when the intent changes.

- Initial intent: daily open-source maintenance assistant that scans projects, recommends fixes, eventually drafts PRs, emails results, and remembers rejected ideas.
- Current constraint: emit reports only; no PR creation or email sending yet.
