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
- It emits the main human-readable report to:

```txt
/tmp/MaintainerBotOut.md
```

It also keeps local copies under `reports/` for debugging/history.

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

## Run

```bash
pnpm run save:daily
```

Primary output:

```txt
/tmp/MaintainerBotOut.md
```

Secondary outputs:

```txt
reports/daily-maintenance.md
reports/daily-maintenance.json
reports/daily-maintenance-YYYY-MM-DD.md
reports/daily-maintenance-YYYY-MM-DD.json
```

Dated daily reports are intended to be committed so we keep report history. Mutable latest files and logs are ignored by git.

## Safety

Draft PR creation is intentionally not enabled by default. Keep:

```bash
CREATE_DRAFT_PRS=false
```

until the scan/report loop is producing useful recommendations.

Rejected ideas should be tracked in:

```txt
data/rejections.json
```

Shared lessons should be tracked in:

```txt
data/lessons.md
```

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
