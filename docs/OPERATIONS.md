# MaintainerBot Operations

## Daily run options

### Cloudflare production path

The production path is already configured through GitHub Actions:

```txt
.github/workflows/daily-maintenance.yml
```

It invokes the protected Hono webhook daily at 09:00 UTC. The route starts the application-owned `MaintainerDailyWorkflow`, using the GitHub run ID as an idempotency key. GitHub Actions then polls the authenticated run-status route until completion, so a late Workflow failure fails the scheduled job instead of being hidden behind an admission `202`. Manual callers may still use `?wait=result` for a bounded synchronous wait and continue through the returned `statusUrl` when it times out.

Required GitHub secret:

```txt
MAINTAINERBOT_WEBHOOK_SECRET
```

### Local cron option

If you also want a local daily run while your machine is on:

```bash
crontab -e
```

Add:

```cron
0 9 * * * cd /Users/adewale/Documents/projects/code/flue-onboarding/MaintainerBot && /opt/homebrew/bin/pnpm run save:daily >/tmp/MaintainerBotCron.log 2>&1
```

## R2 data

All durable Cloudflare data lives in:

```txt
maintainerbot-data
```

Important keys:

```txt
MaintainerBotOut.md
MaintainerBotOut.json
data/rejections.json
data/lessons.md
audits/index.json
audits/projects/<owner>__<repo>/latest.json
audits/projects/<owner>__<repo>/history/<timestamp>.json
reports/daily-maintenance-latest.md
reports/daily-maintenance-latest.json
reports/history/YYYY-MM-DD/daily-maintenance.md
reports/history/YYYY-MM-DD/daily-maintenance.json
reports/history/YYYY-MM-DD/<runId>/daily-maintenance.md
reports/history/YYYY-MM-DD/<runId>/daily-maintenance.json
```

Public living status page:

```txt
https://pub-39149b57d8394ddea78c0ca9f90e087f.r2.dev/MaintainerBotOut.md
```

Public latest JSON:

```txt
https://pub-39149b57d8394ddea78c0ca9f90e087f.r2.dev/MaintainerBotOut.json
```

Pretty HTML status Worker:

```txt
https://maintainerbot-status.adewale-883.workers.dev
```

Deploy the status Worker:

```bash
pnpm run deploy:status
```

Download the living status page:

```bash
pnpm exec wrangler r2 object get maintainerbot-data/MaintainerBotOut.md --remote --file /tmp/MaintainerBotOut.md
```

Download latest report alias:

```bash
pnpm exec wrangler r2 object get maintainerbot-data/reports/daily-maintenance-latest.md --remote --file /tmp/MaintainerBotR2Latest.md
```

Upload rejection ledger:

```bash
pnpm exec wrangler r2 object put maintainerbot-data/data/rejections.json --file data/rejections.json --remote
```

## Email

Email uses Cloudflare Email Routing's `send_email` Worker binding.

Prerequisites:

1. Enable Cloudflare Email Routing for a domain.
2. Verify the destination address in Email Routing.
3. Use a sender address from the Email Routing domain.
4. Keep the `SEND_EMAIL` binding in `wrangler.jsonc`.

Configure:

```bash
EMAIL_TO=you@example.com
EMAIL_FROM=maintainerbot@your-routing-domain.example
EMAIL_DRY_RUN=false
```

If `EMAIL_DRY_RUN=true`, `EMAIL_TO`/`EMAIL_FROM` are missing, or the `SEND_EMAIL` binding is unavailable, no email is sent.

## Optional LLM credentials

Without an LLM provider key, MaintainerBot still builds/reuses context bundles and publishes a degraded surface-audit report. Configure at least one model provider secret to get synthesized recommendations:

```bash
pnpm exec wrangler secret put ANTHROPIC_API_KEY
# or
pnpm exec wrangler secret put OPENAI_API_KEY
# or
pnpm exec wrangler secret put OPENROUTER_API_KEY
```

Without a provider key, the Worker reports `context-only-no-model` mode and skips LLM recommendations.

## GitHub write operations

MaintainerBot is read-only. Do not configure write-scoped GitHub tokens. The bot must not create branches, commits, PRs, comments, labels, issues, releases, or repository setting changes.

If a GitHub token is used, prefer the least-privileged read-only token available.

## Flue 2 deployment migration

Flue 2 replaces generated Flue workflows with hooks-based agents and application-owned orchestration. `wrangler.jsonc` keeps the deployed migration history and appends migrations that delete the beta-only `FlueRegistry`/workflow classes and create `FlueReportAnalystAgent`. R2 remains canonical and must be backed up before the first v2 deployment. Build and inspect with:

```bash
pnpm run build:cloudflare
pnpm exec wrangler deploy --dry-run
```

Do not edit or reorder old migration tags. Deploy with `pnpm run deploy:cloudflare`; Vite and the Cloudflare plugin own the generated Worker config. The current Workflow deliberately disables automatic retries for its coarse side-effecting step; inspect a failed run before restarting it so model calls, email, and external writes are not replayed blindly.

## Deep verification

Run the CLI-only read-only verifier locally or from GitHub Actions when a checkout/test pass is useful:

```bash
pnpm run deep:verify -- --data '{"repo":"adewale/project"}'
```

The verifier refuses repositories not changed since November 17, 2025 and does not push anything.
