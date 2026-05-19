# MaintainerBot Living Spec

MaintainerBot is a read-only daily maintenance handoff for Adewale's public open-source projects.

It only considers repositories changed since November 17, 2025.

Each run:

1. Reads GitHub/R2 facts with deterministic code.
2. Uses cheap project fingerprints to skip unchanged project context rebuilds.
3. Stores durable context bundles in R2.
4. Calls the LLM for changed project audits.
5. Always calls the LLM once to synthesize the daily handoff.
6. Publishes the living status page from deterministic facts plus latest audits.

MaintainerBot must not mutate GitHub: no branches, commits, PRs, comments, labels, issue edits, releases, or repository settings changes. A GitHub token, if used, should be read-only.

Replay is first-class. A stored context bundle plus prompt version, model, schema version, and output should be enough to re-run or compare audits locally without hitting GitHub again.

Phase 1 is surface audit only. Later phases may add read-only checkout/eval/coding-agent workflows, but those workflows produce additional evidence artifacts; they do not change the Phase 1 contract.
