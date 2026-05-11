# MaintainerBot Evergreen Spec

This is the detailed product and technical spec for MaintainerBot. The concise evolving intent lives in `docs/LIVING_SPEC.md`. Keep both updated whenever the intent, architecture, safety model, or roadmap changes.

## Product intent

MaintainerBot is a daily open-source maintenance assistant for Adewale's recently active projects.

It should help maintain many repositories by scanning project activity and quality signals, recommending concrete next steps, learning from accepted/rejected suggestions, and preparing evidence-backed recommendations and verification steps. The scan includes only repositories updated since November 17, 2025.

## Current status

MaintainerBot currently runs in two modes:

1. Local Flue/Node mode, which emits a daily Markdown report to:

```txt
/tmp/MaintainerBotOut.md
```

2. Cloudflare Worker mode, which keeps durable data in R2:

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
reports/daily-maintenance-latest.md
reports/daily-maintenance-latest.json
reports/history/YYYY-MM-DD/daily-maintenance.md
reports/history/YYYY-MM-DD/daily-maintenance.json
```

Primary product interface: `MaintainerBotOut.md` in R2. Every run overwrites this object with the latest effective status of all scanned projects. Historic reports remain immutable-ish dated snapshots under `reports/history/`.

The R2 dev URL is public:

```txt
https://pub-39149b57d8394ddea78c0ca9f90e087f.r2.dev/MaintainerBotOut.md
```

A small status Worker renders the Markdown as pretty HTML:

```txt
https://maintainerbot-status.adewale-883.workers.dev
```

The status Worker lives in:

```txt
workers/status.ts
wrangler.status.jsonc
```

Local debug/history artifacts may also be written under:

```txt
reports/
```

Dated local reports under `reports/daily-maintenance-YYYY-MM-DD.*` are intentionally kept as history. Mutable latest files and logs are ignored.

Current mode is conservative reporting only:

- Scans public, non-fork, non-archived GitHub repositories for `GITHUB_OWNER`.
- Produces a daily report with summary, priority actions, manual action candidates, and shared lessons.
- Does not create PRs.
- Does not send email.
- Does not mutate repositories.

## User goals

Every day, MaintainerBot should scan all of Adewale's projects and look at:

- Issues
- Pull requests
- Best practices and lessons learned
- Efficiency opportunities
- Code quality opportunities
- Shared lessons across repositories

Eventually, it should:

- Identify and verify fixes.
- Identify verification steps and manual PR candidates.
- Track rejected ideas so it never repeats them.

## Core compounding loop

MaintainerBot should improve through this loop:

```txt
Scan → Recommend → Review → Accept/Reject → Record Lesson → Improve Future Runs
```

The compounding assets are local memory files:

```txt
data/rejections.json
data/lessons.md
reports/*.md
future: data/accepted-prs.json
future: data/project-profiles.json
future: data/fix-patterns.json
```

## Architecture

### Runtime

MaintainerBot is currently a Flue app running on Node with a local `just-bash` sandbox.

Main agent:

```txt
.flue/agents/daily-maintenance.ts
```

Maintainer role:

```txt
.flue/roles/maintainer.md
```

Daily runner:

```txt
scripts/run-daily.mjs
```

### Current commands

Local run:

```bash
cd /Users/adewale/Documents/projects/code/flue-onboarding/MaintainerBot
pnpm run save:daily
```

Cloudflare deploy:

```bash
pnpm exec wrangler r2 bucket create maintainerbot-data
pnpm run deploy:cloudflare
```

Cloudflare invocation:

```bash
SECRET=$(cat .webhook-secret)
curl -X POST https://maintainerbot.<subdomain>.workers.dev/agents/daily-maintenance/daily \
  -H 'Content-Type: application/json' \
  -d "{\"webhookSecret\":\"$SECRET\"}"
```

### Configuration

```txt
.env.example
config/projects.json
data/rejections.json
data/lessons.md
```

Important env vars:

```bash
GITHUB_OWNER=adewale
GITHUB_TOKEN=...
FLUE_MODEL=anthropic/claude-haiku-4-5
ANTHROPIC_API_KEY=...
```

## Safety model

MaintainerBot must be conservative by default.

## Secret hygiene

MaintainerBot must be safe to publish to GitHub.

Rules:

- `.env` and `.env.*` are ignored, except `.env.example`.
- Real API keys/tokens must never be committed.
- Use local env vars, GitHub Secrets, Wrangler secrets, or deployment-provider secrets.
- Run `pnpm run check:secrets` before committing or pushing.
- If a real secret is committed, rotate it immediately and remove it from git history if needed.
- Reports should not include raw secret-bearing logs.


Current safety rules:

- The Cloudflare webhook requires `MAINTAINERBOT_WEBHOOK_SECRET` when that secret is configured.
- No PR creation.
- No email sending by default.
- No repository mutation: no branches, commits, PRs, comments, labels, issue edits, releases, or repository setting changes.
- Any GitHub token should be read-only if possible.
- The bot must not repeat rejected ideas from `data/rejections.json`.
- The bot should prefer small, reviewable changes.
- Every proposed fix should include a verification step.
- If evidence is weak, recommend investigation instead of action.

### Protected webhook security rationale

The deployed Cloudflare webhook is safe to keep in a public source-code repository because the repository contains only the **verification logic**, not the **secret value**.

Public code includes this behavior:

```txt
if MAINTAINERBOT_WEBHOOK_SECRET is configured, require payload.webhookSecret to match it
```

The actual secret is stored outside git:

```txt
Local development: .webhook-secret or .env, both ignored by git
Production: Cloudflare Worker secret MAINTAINERBOT_WEBHOOK_SECRET
```

This means an attacker can read the source code and know that a secret is required, but cannot invoke the protected job unless they also know the secret value. This is the same security pattern used by API keys, bearer tokens, and webhook signing secrets: the algorithm/check can be public, while the secret remains private.

Current limitations:

- The secret is sent in the JSON payload because Flue agent handlers currently expose `payload` and `env`, not raw request headers.
- Payload-based shared-secret auth is sufficient for a private scheduled caller over HTTPS, but header-based auth would be cleaner if/when Flue exposes request headers.
- If the secret is leaked, rotate it with `wrangler secret put MAINTAINERBOT_WEBHOOK_SECRET` and update `.webhook-secret` locally.

Operational rules:

- Never commit `.webhook-secret`, `.env`, or any real token.
- Use HTTPS only.
- Rotate the webhook secret if it is exposed in logs, screenshots, shell history, or chat.
- Prefer a dedicated random secret, not a reused password or API token.

## LLM project-context handoff

When model credentials are configured, MaintainerBot performs daily LLM audits only for projects whose audit inputs changed since their previous LLM audit. It hands the LLM a structured, deterministic project context object for each changed repository. This keeps GitHub/API scanning as the source of truth while letting the LLM improve prioritization and recommendations without re-auditing unchanged projects.

Each project context includes:

- repo name and URL
- description, language, and last pushed date
- repo health signals: README, license, CI, package.json, test/check scripts, lockfile, package manager
- open TODOs discovered from root `TODO.md`, `TODOS.md`, `todo.md`, or `todo.txt`
- open issues for that repo
- open PRs for that repo
- deterministic findings for that repo
- rejected fingerprints to avoid
- shared lessons ledger

Audit inputs are hashed and compared against the previous audit stored in R2. The hash includes repo metadata, health signals, open TODOs, open issues/PRs, deterministic finding fingerprints, and the lessons ledger hash.

Audit storage in R2:

```txt
audits/index.json
audits/projects/<owner>__<repo>/latest.json
audits/projects/<owner>__<repo>/history/<timestamp>.json
```

The LLM must:

- use only supplied JSON
- not invent repos, issues, PRs, files, or TODOs
- emit stable fingerprints
- cite evidence
- avoid rejected fingerprints
- prefer small, reviewable actions
- never claim GitHub state was changed

Secrets are not included in this project context.

## Report contract

The daily report should eventually include:

- Summary
- Priority actions
- Issue triage with priority labels
- PR triage with priority labels
- Best practices and lessons learned
- Efficiency opportunities
- Code quality opportunities
- Shared cross-repo lessons
- Manual action candidates
- Verification evidence
- Rejected/repeated ideas filtered out

Current report sections are arranged so the most actionable items come first:

- Action inbox: ranked, clickable actions with why/action guidance
- Manual action candidates with stable fingerprints and suggested action
- Open PRs needing review with links, priority, rationale, and action
- Open issues needing triage with links, priority, rationale, and action
- Repo health fixes grouped by best practices, efficiency, and code quality
- Summary and run metadata
- Read-only status / mutation results, which should always report no GitHub mutations
- Shared lessons

## Rejection memory

Rejected ideas live in:

```txt
data/rejections.json
```

Target schema:

```json
{
  "version": 1,
  "rejected": [
    {
      "repo": "adewale/example",
      "fingerprint": "stable-change-fingerprint",
      "title": "Suggestion title",
      "reason": "Why this was rejected",
      "rejectedAt": "2026-05-07T00:00:00.000Z"
    }
  ]
}
```

Future behavior:

- Every recommendation gets a stable fingerprint.
- Before reporting or creating a PR, MaintainerBot checks the rejection ledger.
- Rejected fingerprints are suppressed unless the user explicitly clears them.

## Lessons memory

Shared lessons live in:

```txt
data/lessons.md
```

Lessons should capture reusable preferences, project conventions, and maintenance patterns.

Examples:

- Prefer small PRs with verification notes.
- Avoid cosmetic-only churn unless explicitly requested.
- Add setup/run instructions to README files for small tool repos.

## Read-only GitHub policy

MaintainerBot must not mutate GitHub. It can recommend actions, labels, PR ideas, or verification steps, but humans apply them.

Forbidden actions:

- creating branches, commits, or PRs
- posting comments
- adding/removing labels
- editing issues, PRs, releases, repository metadata, or settings
- publishing packages or releases

Allowed actions:

- read GitHub API metadata
- read issue/PR/check/workflow information
- clone public repos into temporary local/CI sandboxes for verification
- write MaintainerBot's own R2 report/audit objects

## Status page policy

The primary output should be a living Markdown status page in R2:

```txt
MaintainerBotOut.md
```

It should always represent the latest effective status across all scanned projects. This is preferred over email because it is bookmarkable, shareable, low-noise, easy to diff, and can later be served as HTML by a Worker while keeping the R2 bucket private.

The JSON equivalent is:

```txt
MaintainerBotOut.json
```

Email should be treated as an optional alerting channel for important events, not the main interface.

## Email policy

Email delivery uses Cloudflare Email Routing's `send_email` Worker binding, following Cloudflare's Email Workers documentation.

It sends the rendered daily report when these are present and dry-run is disabled:

```bash
# Worker binding in wrangler.jsonc
send_email.name = SEND_EMAIL

# Runtime vars/secrets
EMAIL_TO=you@example.com
EMAIL_FROM=maintainerbot@your-routing-domain.example
EMAIL_DRY_RUN=false
```

Prerequisites:

- Cloudflare Email Routing is enabled for a domain.
- `EMAIL_TO` is a verified Email Routing destination address.
- `EMAIL_FROM` is from the domain where Email Routing is active.

Rules:

- Support dry-run mode.
- Avoid sending secrets or raw logs.

## Scheduling and CI

MaintainerBot has GitHub Actions workflows:

```txt
.github/workflows/daily-maintenance.yml
.github/workflows/ci.yml
```

The daily workflow invokes the protected Cloudflare webhook at 09:00 UTC using the GitHub repository secret `MAINTAINERBOT_WEBHOOK_SECRET`.

The CI workflow runs Gitleaks, local secret scanning, rejection-memory tests, and Cloudflare build checks on pushes and PRs.

## Maturity stages

### Stage 1: Reporter

Status: current.

```txt
scan repos → write /tmp/MaintainerBotOut.md
```

### Stage 2: Personalized reporter

```txt
scan + rejection memory + lessons ledger + better report sections
```

### Stage 3: Verifier

```txt
clone repos → inspect code → run checks → recommend evidence-backed fixes
```

### Stage 4: Read-only deep auditor

```txt
changed projects → clone in temporary sandbox → run checks → publish evidence-backed recommendations
```

### Stage 5: Maintainer handoff

```txt
living status page → ranked actions → rejection memory → cross-repo lessons
```

## Deferred work

The canonical deferred-work list is:

```txt
TODO.md
```

Keep `TODO.md` and this spec in sync.

## Open design questions

- Should MaintainerBot use local just-bash, local host filesystem, or remote sandbox for repository cloning?
- How should rejection fingerprints be generated?
- Should the bot maintain per-repository profiles?
- How should read-only deep verification be scheduled and budgeted?

## Update rule

Whenever MaintainerBot's behavior, safety policy, memory model, or roadmap changes, update this file in the same change.
