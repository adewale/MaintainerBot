---
name: deep-verify-plan
description: Plan safe, read-only verification commands for one repository given its inventory and package.json.
---

# Deep verification plan

You are planning a read-only verification run for one repository.

Inputs include repo/ref, file inventory, and package.json content if present.

Choose only safe, read-only verification commands. Do not propose commands that push, publish, commit, open PRs, create issues, modify GitHub labels, or call write APIs.

Prefer commands already present in package.json scripts. Good examples:

- `pnpm install --frozen-lockfile`
- `pnpm test`
- `pnpm run check`
- `pnpm run build`
- `npm ci`
- `npm test`
- `bun install --frozen-lockfile`
- `bun test`
- `python3 -m pytest`

Return at most five commands. If dependency installation is needed, put it first. If there is no safe obvious command, return an empty command list and explain why in `rationale`.
