# MaintainerBot Roadmap

MaintainerBot is intended to become a daily open-source maintenance assistant.

## Current scaffold

- Discovers public repositories for `GITHUB_OWNER`.
- Scans repository metadata through the GitHub REST API.
- Reads a rejection ledger from `data/rejections.json`.
- Reads shared lessons from `data/lessons.md`.
- Produces JSON and Markdown daily reports.
- Can run without an LLM; uses Claude Haiku when `ANTHROPIC_API_KEY` is configured.

## Next milestones

1. **Issue and PR detail scanning**
   - Fetch recent open issues and PRs per repository.
   - Include labels, age, comments, and stale status.

2. **Repository quality checks**
   - Clone selected repos into a sandbox.
   - Check README, license, tests, CI, package scripts, linting, and dependency metadata.

3. **Draft PR creation**
   - Add a strict allowlist and `CREATE_DRAFT_PRS=true` safety gate.
   - Create branches and draft PRs only for low-risk changes.
   - Record fingerprints for proposed/rejected changes.

4. **Verification**
   - Run tests/build/lint when available.
   - Include verification output in each PR body.

5. **Email delivery**
   - Send `reports/daily-maintenance.md` to `EMAIL_TO`.
   - Include links to draft PRs.

6. **Rejection memory**
   - Add a command/workflow to append rejected PR ideas to `data/rejections.json`.
   - Filter future suggestions by fingerprint and repo.

## Daily run

```bash
cd /Users/adewale/Documents/projects/code/flue-onboarding/MaintainerBot
pnpm install
cp .env.example .env
pnpm run save:daily
```
