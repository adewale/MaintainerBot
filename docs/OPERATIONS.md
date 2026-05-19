# MaintainerBot Operations

## Daily run options

### Cloudflare production path

The production path is already configured through GitHub Actions:

```txt
.github/workflows/daily-maintenance.yml
```

It invokes the protected Cloudflare webhook daily at 09:00 UTC.

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

## Required LLM credentials

Every successful MaintainerBot invocation calls an LLM after deterministic scanning. Configure at least one model provider secret before deploying/running:

```bash
pnpm exec wrangler secret put ANTHROPIC_API_KEY
# or
pnpm exec wrangler secret put OPENAI_API_KEY
# or
pnpm exec wrangler secret put OPENROUTER_API_KEY
```

Without a provider key, the Worker returns a configuration error instead of producing a deterministic-only report.

## GitHub write operations

MaintainerBot is read-only. Do not configure write-scoped GitHub tokens. The bot must not create branches, commits, PRs, comments, labels, issues, releases, or repository setting changes.

If a GitHub token is used, prefer the least-privileged read-only token available.

## Deep verification

Run the CLI-only read-only verifier locally or from GitHub Actions when a checkout/test pass is useful:

```bash
pnpm run deep:verify -- --payload '{"repo":"adewale/project"}'
```

The verifier refuses repositories not changed since November 17, 2025 and does not push anything.
