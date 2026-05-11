# MaintainerBot Security

## Public source, private secrets

MaintainerBot is safe to publish because source code contains checks and adapters, not secret values.

Secrets live in:

- Cloudflare Worker secrets
- GitHub repository secrets
- local ignored files such as `.env` and `.webhook-secret`

Never commit real tokens.

## Protected webhook

The Cloudflare webhook requires `MAINTAINERBOT_WEBHOOK_SECRET` when configured. The secret is sent in the JSON payload because Flue currently exposes payload/env to agents rather than raw request headers.

If the secret leaks:

```bash
openssl rand -hex 32 > .webhook-secret
pnpm exec wrangler secret put MAINTAINERBOT_WEBHOOK_SECRET < .webhook-secret
gh secret set MAINTAINERBOT_WEBHOOK_SECRET < .webhook-secret
```

## Checks

Run before pushing:

```bash
pnpm run check:secrets
pnpm run test:rejections
pnpm run build:cloudflare
```

CI also runs Gitleaks.

## GitHub read-only safety

MaintainerBot must not mutate GitHub. Do not configure write-scoped tokens. If `GITHUB_TOKEN` is provided, prefer a read-only token used only for API rate limits and reading public/private metadata as needed.

Forbidden operations include creating branches, commits, PRs, comments, labels, issues, releases, or repository setting changes.
