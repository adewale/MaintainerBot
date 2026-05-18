# MaintainerBot Living Spec

MaintainerBot is a read-only maintenance assistant for Adewale's public open-source projects.

It scans only repositories that changed since November 17, 2025, gathers deterministic GitHub/project signals, and publishes an action-first living status page backed by R2.

Every successful invocation calls an LLM. Deterministic tools gather facts first; the LLM synthesizes the final human handoff from those facts. Context is a first-class artifact: each run creates a stored run context bundle, while project context bundles are rebuilt only when cheap deterministic discovery detects a changed project state fingerprint. Per-project LLM audits run only when a project's context changes; unchanged projects reuse their previous context bundle and carry forward their previous audit. The run still performs an LLM synthesis call using deterministic facts and latest project audits.

MaintainerBot may recommend actions, verification steps, labels, or PR ideas, but it must not mutate GitHub: no branches, commits, PRs, comments, labels, issue edits, or repository settings changes.

Deep verification should happen in read-only CLI workflows that clone repos into temporary sandboxes, run safe checks/tests/builds, summarize evidence, and store/report results without pushing anything.

Stored context bundles make audits replayable locally and comparable across multiple agents/models without re-running GitHub loaders.

The goal is a trustworthy daily handoff: what changed, what matters, why it matters, and how to verify the next human action.
