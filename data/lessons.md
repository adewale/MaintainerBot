# MaintainerBot Lessons Ledger

Use this file to record recurring best practices and lessons learned across projects.

## Shared lessons

- Prefer small, reviewable PRs.
- Add tests or verification notes with every fix.
- Avoid repeating rejected changes from `data/rejections.json`.
- After Flue beta upgrades, validate Durable Object internals with Wrangler tail; a successful workflow result can hide reset-only schema failures in registry/history bookkeeping.
- For Cloudflare Durable Object schema resets, use a temporary uncommitted reset deployment and immediately redeploy normal code; do not try to delete and recreate the same class in one migration.
