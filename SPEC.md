# MaintainerBot Evergreen Spec

This is the evergreen product and technical spec for MaintainerBot. Keep this file updated whenever the intent, architecture, safety model, or roadmap changes.

## Product intent

MaintainerBot is a daily open-source maintenance assistant for Adewale's projects.

It should help maintain many repositories by scanning project activity and quality signals, recommending concrete next steps, learning from accepted/rejected suggestions, and eventually preparing safe draft PRs with verification evidence.

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
data/created-prs.json
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

Local debug/history artifacts may also be written under:

```txt
reports/
```

Dated local reports under `reports/daily-maintenance-YYYY-MM-DD.*` are intentionally kept as history. Mutable latest files and logs are ignored.

Current mode is conservative reporting only:

- Scans public, non-fork, non-archived GitHub repositories for `GITHUB_OWNER`.
- Produces a daily report with summary, priority actions, draft PR candidates, and shared lessons.
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
- Create safe draft PRs.
- Email a series of PRs/recommendations that fix or improve projects.
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
CREATE_DRAFT_PRS=false
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
- No PR creation by default.
- No email sending by default.
- No repository mutation by default.
- Draft PR creation must require `CREATE_DRAFT_PRS=true`.
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
- Draft PR candidates
- Verification evidence
- Rejected/repeated ideas filtered out

Current report sections:

- Summary
- Priority actions with P0/P1/P2/P3 priority prefixes
- Open issues with links, age, labels, comments, and author
- Open pull requests with links, age, labels, comments, and author
- Best-practice findings
- Efficiency findings
- Code-quality findings
- Draft PR candidates with stable fingerprints
- Draft PR creation results
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

## Draft PR policy

Draft PR creation is implemented but disabled by default.

It only runs when all of the following are true:

```bash
CREATE_DRAFT_PRS=true
GITHUB_TOKEN=...
DRAFT_PR_REPO_ALLOWLIST=adewale/example,adewale/another-example
```

When enabled, MaintainerBot currently creates small draft PRs for allowlisted repositories only. The first implementation writes a `MAINTAINERBOT.md` recommendation file on a `maintainerbot/*` branch and opens a draft PR with verification notes. This is intentionally conservative and should evolve toward real verified fixes.

It must:

1. Use a strict allowlist of repositories.
2. Create small branches only.
3. Make low-risk changes first.
4. Run tests/build/lint or provide static verification evidence.
5. Open PRs as drafts.
6. Include clear PR bodies:
   - Summary
   - Reason
   - Files changed
   - Verification
   - Risk level
7. Record created PRs in a local ledger.
8. Never repeat rejected fingerprints.

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

- Include draft PR links once PR creation exists.
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

### Stage 4: Draft PR creator

```txt
make small fixes → run checks → create draft PRs
```

### Stage 5: Maintainer assistant

```txt
daily email → ranked PRs → rejection memory → cross-repo lessons
```

## Deferred work

The canonical deferred-work list is:

```txt
TODO.md
```

Keep `TODO.md` and this spec in sync.

## Open design questions

- Should MaintainerBot use local just-bash, local host filesystem, or remote sandbox for repository cloning?
- What provider should send email?
- Should accepted PRs be tracked automatically by merge status?
- How should rejection fingerprints be generated?
- Should the bot maintain per-repository profiles?
- How aggressive should code-quality PR generation be?

## Update rule

Whenever MaintainerBot's behavior, safety policy, memory model, or roadmap changes, update this file in the same change.
