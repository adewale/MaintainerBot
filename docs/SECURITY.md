# MaintainerBot Security

## Public source, private secrets

MaintainerBot is safe to publish because source code contains checks and adapters, not secret values.

Secrets live in:

- Cloudflare Worker secrets
- GitHub repository secrets
- local ignored files such as `.env` and `.webhook-secret`

Never commit real tokens.

## Protected webhook

The Hono webhook requires `MAINTAINERBOT_WEBHOOK_SECRET` and fails closed with `503` when the deployment is missing it. The secret is sent in the JSON payload, validated before the application-owned Cloudflare Workflow starts, and never forwarded in Workflow parameters or Flue agent messages. The run-status route requires the same secret as a bearer token.

`ReportAnalyst` is dispatch-only: it is registered for trusted application calls but has no public agent route. GitHub/R2 secrets and bindings stay in trusted pipeline code.

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
pnpm run check
pnpm test
pnpm run build:cloudflare
```

CI also runs Gitleaks.

## Local sprintf-js precision patch

`just-bash` (directly and through `agents`) resolves `sprintf-js@1.1.3`.
[GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)
has no published patched version. The pnpm lockfile applies
`patches/sprintf-js@1.1.3.patch`: numeric precision is validated before native
conversion and `%g` maps zero precision to one significant digit, following the
[upstream remediation](https://github.com/alexei/sprintf.js/issues/237).
Text precision and valid numeric formatting retain their existing behavior.

Malformed numeric formats still raise a controlled `SyntaxError`; callers must
catch invalid-format errors. This is not a claim that arbitrary untrusted
templates are safe without error handling. The existing JustBash command boundary
contains formatting errors; its rejection and continued execution are tested.

`pnpm install --frozen-lockfile` applies the patch reproducibly. The contract test
resolves the actual consumer's formatter, not a separate copy. A registry audit
still reports the moderate advisory because the package version is unchanged;
we do not ignore it or claim a clean audit. Remove this patch only after a
compatible upstream fix passes the same controls. No production deployment is
implied by this source fix.

## GitHub read-only safety

MaintainerBot must not mutate GitHub. Do not configure write-scoped tokens. If `GITHUB_TOKEN` is provided, prefer a read-only token used only for API rate limits and reading public/private metadata as needed.

Forbidden operations include creating branches, commits, PRs, comments, labels, issues, releases, or repository setting changes.
