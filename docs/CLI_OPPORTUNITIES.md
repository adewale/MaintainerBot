# CLI-only Opportunities

MaintainerBot's scheduled Worker should stay lightweight and read-only. CLI-only Flue agents and local/GitHub Actions tools are better for anything that needs a checkout, dependency install, or command execution.

## Added: `deep-verify`

`deep-verify` is a CLI-only, read-only Flue agent:

```bash
pnpm run deep:verify -- --payload '{"repo":"adewale/project"}'
```

It:

- fetches repo metadata with an optional read-only GitHub token
- refuses repos not changed since `2025-11-17T00:00:00.000Z`
- clones the repo into `/tmp`
- asks a skill to choose safe verification commands
- runs at most five allowlisted commands
- summarizes evidence and recommended next human actions
- never pushes, comments, labels, opens PRs, or edits GitHub state

## Where CLI-only agents/tools help

- **Deep verification:** clone repo, install deps, run tests/build/check/lint.
- **CI log summarization:** fetch failed workflow/job logs with `gh` or GitHub REST, truncate logs, summarize likely failure causes.
- **Issue reproduction:** for a selected issue, checkout repo and attempt reproduction in a throwaway sandbox.
- **TODO drift checks:** compare TODO files, README claims, package scripts, and CI workflows from an actual checkout.
- **Dependency/package-manager checks:** inspect lockfiles and run package-manager-specific commands safely.
- **Report regeneration:** run the same report pipeline locally for debugging without exposing an HTTP route.

## Lessons borrowed from Astro's `.flue`

- **Use CLI-only agents for heavyweight work.** No public route is needed for checkout/test workflows.
- **Use command allowlists.** Pass only the commands a workflow needs.
- **Stage workflows.** Prefer `plan → run checks → summarize` over one large prompt.
- **Fetch noisy external data before prompting.** CI logs should be fetched and truncated before the LLM sees them.
- **Use schemas for every LLM result.** Structured outputs make reports stable and machine-checkable.
- **Retriage only when inputs changed.** This matches MaintainerBot's R2 audit-input hash ledger.
- **Keep mutation separate.** Astro can comment/label/push; MaintainerBot intentionally does not.
