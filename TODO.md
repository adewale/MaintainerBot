# MaintainerBot TODO

Deferred work and future milestones.

## Reporting

- [x] Keep dated daily report history in R2.
- [x] Emit the primary Cloudflare/R2 living status page to `MaintainerBotOut.md`.
- [x] Improve the daily Markdown report format.
- [x] Add sections for issues, PRs, read-only audit status, and shared lessons.
- [x] Add dedicated sections for best practices, lessons learned, efficiency, and code quality.
- [x] Add severity/priority scoring.
- [x] Add stable fingerprints for every deterministic recommendation.
- [x] Add links to source evidence for issue/PR items.

## GitHub scanning

- [x] Fetch detailed open issues across the owner account.
- [x] Fetch detailed open PRs across the owner account.
- [x] Include issue/PR age, labels, comment count, author, and last activity.
- [x] Detect stale issues and PRs.
- [x] Detect repos missing README, LICENSE, CI, tests, or package scripts.
- [x] Detect dependency/tooling health signals.
- [x] Only consider repositories changed since November 17, 2025.

## Code quality and efficiency

- [x] Add CLI-only read-only `deep-verify` workflow scaffold.
- [ ] Run `deep-verify` for selected projects and feed results into the status page.
- [ ] Add read-only CI log fetching/summarization.
- [x] Identify small code quality improvements from GitHub metadata/API checks.
- [x] Identify efficiency/performance improvements from GitHub metadata/API checks.

## Read-only safety

- [x] Make MaintainerBot read-only: no branches, commits, PRs, comments, labels, or repo mutations.
- [x] Remove active draft PR creation path.
- [ ] Audit configuration to ensure any GitHub token is read-only/least-privileged.

## Rejection memory

- [x] Expand `data/rejections.json` schema in the spec.
- [x] Add command/script to record rejected ideas.
- [x] Add fingerprint matching so rejected ideas are filtered before reporting.
- [x] Add tests for rejection filtering.

## Scheduling

- [x] Add GitHub Actions scheduled workflow.
- [ ] Consider Cloudflare scheduled Worker deployment later if GitHub Actions scheduling becomes insufficient.

## Cloudflare/R2 deployment

- [x] Add Cloudflare Worker build/deploy scripts.
- [x] Create/bind R2 bucket `maintainerbot-data`.
- [x] Store rejections, lessons, latest reports, audit history, and historic reports in R2.
- [x] Deploy webhook agent to Cloudflare.
- [x] Add a daily scheduler that invokes the Cloudflare webhook.
- [x] Add shared-secret protection for the public webhook endpoint.
- [ ] Consider moving from payload secret to header-based auth if Flue exposes request headers.

## Context bundles

- [x] Document durable run/project context bundle model.
- [x] Persist context index to `contexts/index.json` with project state fingerprints.
- [x] Persist run context bundles to `contexts/runs/<runId>.json`.
- [x] Persist project context bundles to `contexts/projects/<owner>__<repo>/*` only when state fingerprints change.
- [ ] Add local replay command that reads a stored context bundle and re-runs LLM synthesis.
- [ ] Add comparison workflow for multiple agents/models over the same stored context.

## Flue/runtime evolution

- [x] Keep current local `just-bash` scan path simple.
- [x] Add CLI-only read-only verifier for real repo cloning and test runs.
- [x] Add Cloudflare AI Gateway provider configuration.
- [x] Require LLM-assisted daily synthesis on every successful invocation.
- [x] Add changed-project-only LLM audit ledger in R2.

## Secret hygiene

- [x] Ignore `.env` and `.env.*` files while keeping `.env.example`.
- [x] Add `pnpm run check:secrets`.
- [x] Add a GitHub Actions check that runs `pnpm run check:secrets` on PRs.
- [x] Add Gitleaks in CI for stronger scanning.

## Documentation

- [x] Add concise living spec in `docs/LIVING_SPEC.md`.
- [x] Document CLI-only opportunities and Astro lessons.
- [x] Document safety boundaries and secret handling.
