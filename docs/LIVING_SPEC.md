# MaintainerBot Living Spec

MaintainerBot is a read-only maintenance assistant for Adewale's public open-source projects.

It scans only repositories that changed since November 17, 2025, gathers deterministic GitHub/project signals, and publishes an action-first living status page backed by R2.

Every successful invocation calls an LLM. Deterministic tools gather facts first; the LLM synthesizes the final human handoff from those facts. It also runs per-project LLM audits only for projects whose audit inputs changed since their last LLM audit. Unchanged projects carry forward their previous project audit, but the run still performs an LLM synthesis call.

MaintainerBot may recommend actions, verification steps, labels, or PR ideas, but it must not mutate GitHub: no branches, commits, PRs, comments, labels, issue edits, or repository settings changes.

Deep verification should happen in read-only CLI workflows that clone repos into temporary sandboxes, run safe checks/tests/builds, summarize evidence, and store/report results without pushing anything.

The goal is a trustworthy daily handoff: what changed, what matters, why it matters, and how to verify the next human action.
