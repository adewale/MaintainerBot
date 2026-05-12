# MaintainerBot Roadmap

MaintainerBot is a read-only daily maintenance handoff for Adewale's public open-source projects.

## Current scaffold

- Scans public, non-fork, non-archived repositories for `GITHUB_OWNER`.
- Only considers repositories changed since November 17, 2025.
- Reads open issues, open PRs, root TODO files, and repo health signals.
- Stores reports, lessons, rejections, and LLM audit history in R2.
- Publishes a living Markdown/HTML status page.
- Requires LLM credentials and calls an LLM on every successful invocation.
- Runs changed-project-only per-project LLM audits, then always runs a final LLM synthesis of the daily handoff.
- Never mutates GitHub.

## Next milestones

1. **Deep verification**
   - Use the CLI-only `deep-verify` agent for selected changed projects.
   - Clone repos into temporary sandboxes.
   - Run safe tests/build/check commands.
   - Feed evidence back into the living status page.

2. **CI log analysis**
   - Fetch failed workflow/job logs through read-only GitHub APIs.
   - Truncate noisy logs before prompting.
   - Recommend likely next human action.

3. **Issue/PR-specific read-only audits**
   - Re-audit only when issue/PR comments or checks changed.
   - Summarize reproduction/verification ideas without commenting or labeling.

4. **Better memory**
   - Improve rejection fingerprints.
   - Add per-project profiles.
   - Track recurring cross-repo maintenance patterns.

## Daily run

```bash
cd /Users/adewale/Documents/projects/code/flue-onboarding/MaintainerBot
pnpm install
cp .env.example .env
pnpm run save:daily
```
