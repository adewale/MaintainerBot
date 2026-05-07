# MaintainerBot TODO

Deferred work and future milestones.

## Reporting

- [x] Keep dated daily report history in `reports/daily-maintenance-YYYY-MM-DD.*`.
- [x] Emit the primary latest report to `/tmp/MaintainerBotOut.md`.
- [x] Improve the daily Markdown report format.
- [x] Add sections for issues, PRs, draft PR creation results, and shared lessons.
- [ ] Add dedicated sections for best practices, lessons learned, efficiency, and code quality.
- [ ] Add severity/priority scoring.
- [x] Add stable fingerprints for every deterministic recommendation.
- [x] Add links to source evidence for issue/PR items.

## GitHub scanning

- [x] Fetch detailed open issues across the owner account.
- [x] Fetch detailed open PRs across the owner account.
- [x] Include issue/PR age, labels, comment count, author, and last activity.
- [x] Detect stale issues and PRs.
- [ ] Detect repos missing README, LICENSE, CI, tests, or package scripts.
- [ ] Detect dependency/tooling health signals.

## Code quality and efficiency

- [ ] Clone selected repositories into a sandbox.
- [ ] Run available tests/build/lint commands.
- [ ] Identify small code quality improvements.
- [ ] Identify efficiency/performance improvements.
- [ ] Verify fixes before recommending PRs.

## Draft PR creation

- [x] Keep `CREATE_DRAFT_PRS=false` until reporting is reliable.
- [x] Add a strict allowlist for repos where PR creation is allowed.
- [x] Create branches for low-risk changes only when explicitly enabled.
- [x] Open draft PRs with clear titles, summaries, and verification notes when explicitly enabled.
- [x] Never create a PR matching a rejected fingerprint.
- [ ] Record every created PR in an R2 ledger.

## Rejection memory

- [x] Expand `data/rejections.json` schema in the spec.
- [ ] Add command/script to record rejected ideas.
- [x] Add fingerprint matching so rejected ideas are filtered before reporting.
- [ ] Add tests for rejection filtering.

## Email delivery

- [ ] Choose email provider/API.
- [ ] Implement sending `/tmp/MaintainerBotOut.md` to `EMAIL_TO`.
- [ ] Include draft PR links once PR creation exists.
- [ ] Add dry-run mode for email output.

## Scheduling

- [ ] Add local cron instructions.
- [x] Add GitHub Actions scheduled workflow.
- [ ] Consider Cloudflare scheduled Worker deployment later.

## Cloudflare/R2 deployment

- [x] Add Cloudflare Worker build/deploy scripts.
- [x] Create/bind R2 bucket `maintainerbot-data`.
- [x] Store rejections, lessons, latest reports, and historic reports in R2.
- [x] Deploy webhook agent to Cloudflare.
- [x] Add a daily scheduler that invokes the Cloudflare webhook.
- [x] Add shared-secret protection for the public webhook endpoint.
- [ ] Consider moving from payload secret to header-based auth if Flue exposes request headers.

## Flue/runtime evolution

- [ ] Keep current local `just-bash` scan path simple.
- [ ] Add remote sandbox option for real repo cloning and test runs.
- [ ] Add Cloudflare AI Gateway provider configuration.
- [ ] Add LLM-assisted summarization once model credentials are configured.

## Secret hygiene

- [x] Ignore `.env` and `.env.*` files while keeping `.env.example`.
- [x] Add `pnpm run check:secrets`.
- [x] Add a GitHub Actions check that runs `pnpm run check:secrets` on PRs.
- [ ] Consider adding gitleaks/trufflehog for stronger scanning.

## Documentation

- [ ] Keep `README.md` updated as the evolving intent document.
- [ ] Move implementation details into `docs/` as the project grows.
- [ ] Document safety boundaries and secret handling.
