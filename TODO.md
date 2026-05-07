# MaintainerBot TODO

Deferred work and future milestones.

## Reporting

- [x] Keep dated daily report history in `reports/daily-maintenance-YYYY-MM-DD.*`.
- [x] Emit the primary latest report to `/tmp/MaintainerBotOut.md`.
- [ ] Improve the daily Markdown report format.
- [ ] Add sections for issues, PRs, best practices, lessons learned, efficiency, code quality, and shared lessons.
- [ ] Add severity/priority scoring.
- [ ] Add stable fingerprints for every recommendation.
- [ ] Add links to source evidence for each recommendation.

## GitHub scanning

- [ ] Fetch detailed open issues per repository.
- [ ] Fetch detailed open PRs per repository.
- [ ] Include issue/PR age, labels, comment count, assignees, and last activity.
- [ ] Detect stale issues and PRs.
- [ ] Detect repos missing README, LICENSE, CI, tests, or package scripts.
- [ ] Detect dependency/tooling health signals.

## Code quality and efficiency

- [ ] Clone selected repositories into a sandbox.
- [ ] Run available tests/build/lint commands.
- [ ] Identify small code quality improvements.
- [ ] Identify efficiency/performance improvements.
- [ ] Verify fixes before recommending PRs.

## Draft PR creation

- [ ] Keep `CREATE_DRAFT_PRS=false` until reporting is reliable.
- [ ] Add a strict allowlist for repos where PR creation is allowed.
- [ ] Create branches for low-risk changes only.
- [ ] Open draft PRs with clear titles, summaries, and verification notes.
- [ ] Never create a PR matching a rejected fingerprint.
- [ ] Record every created PR in a local/state ledger.

## Rejection memory

- [ ] Expand `data/rejections.json` schema.
- [ ] Add command/script to record rejected ideas.
- [ ] Add fingerprint matching so rejected ideas are filtered before reporting.
- [ ] Add tests for rejection filtering.

## Email delivery

- [ ] Choose email provider/API.
- [ ] Implement sending `/tmp/MaintainerBotOut.md` to `EMAIL_TO`.
- [ ] Include draft PR links once PR creation exists.
- [ ] Add dry-run mode for email output.

## Scheduling

- [ ] Add local cron instructions.
- [ ] Add GitHub Actions scheduled workflow.
- [ ] Consider Cloudflare scheduled Worker deployment later.

## Cloudflare/R2 deployment

- [x] Add Cloudflare Worker build/deploy scripts.
- [x] Create/bind R2 bucket `maintainerbot-data`.
- [x] Store rejections, lessons, latest reports, and historic reports in R2.
- [x] Deploy webhook agent to Cloudflare.
- [ ] Add a daily scheduler that invokes the Cloudflare webhook.
- [ ] Add auth protection for the public webhook endpoint.

## Flue/runtime evolution

- [ ] Keep current local `just-bash` scan path simple.
- [ ] Add remote sandbox option for real repo cloning and test runs.
- [ ] Add Cloudflare AI Gateway provider configuration.
- [ ] Add LLM-assisted summarization once model credentials are configured.

## Secret hygiene

- [x] Ignore `.env` and `.env.*` files while keeping `.env.example`.
- [x] Add `pnpm run check:secrets`.
- [ ] Add a GitHub Actions check that runs `pnpm run check:secrets` on PRs.
- [ ] Consider adding gitleaks/trufflehog for stronger scanning.

## Documentation

- [ ] Keep `README.md` updated as the evolving intent document.
- [ ] Move implementation details into `docs/` as the project grows.
- [ ] Document safety boundaries and secret handling.
