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
data/rejections.json
data/lessons.md
reports/daily-maintenance-latest.md
reports/daily-maintenance-latest.json
reports/history/YYYY-MM-DD/daily-maintenance.md
reports/history/YYYY-MM-DD/daily-maintenance.json
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
curl -X POST https://maintainerbot.<subdomain>.workers.dev/agents/daily-maintenance/daily \
  -H 'Content-Type: application/json' \
  -d '{}'
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

- No PR creation by default.
- No email sending by default.
- No repository mutation by default.
- Draft PR creation must require `CREATE_DRAFT_PRS=true`.
- The bot must not repeat rejected ideas from `data/rejections.json`.
- The bot should prefer small, reviewable changes.
- Every proposed fix should include a verification step.
- If evidence is weak, recommend investigation instead of action.

## Report contract

The daily report should eventually include:

- Summary
- Priority actions
- Issue triage
- PR triage
- Best practices and lessons learned
- Efficiency opportunities
- Code quality opportunities
- Shared cross-repo lessons
- Draft PR candidates
- Verification evidence
- Rejected/repeated ideas filtered out

Current report sections:

- Summary
- Priority actions
- Draft PR candidates
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

Draft PR creation is deferred.

When implemented, it must:

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

## Email policy

Email delivery is deferred.

When implemented, it should:

- Send `/tmp/MaintainerBotOut.md` or an equivalent rendered summary.
- Include links to draft PRs once PR creation exists.
- Support dry-run mode.
- Avoid sending secrets or raw logs.

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
