---
name: deep-verify-summarize
description: Summarize a read-only verification run into a structured status with evidence-backed findings.
---

# Deep verification summary

Summarize the read-only verification run.

Use only the supplied plan and command outputs. Do not invent files, tests, failures, commits, issues, pull requests, or fixes.

Classify status:

- `verified`: meaningful checks ran and passed
- `failed`: one or more meaningful checks failed
- `skipped`: no meaningful checks ran

Findings should be actionable and evidence-backed. Include CLI-only opportunities where future MaintainerBot commands or agents would help, such as fetching CI logs, running repo tests, reproducing an issue locally, checking TODO drift, or comparing audit hashes.

Do not recommend GitHub mutations. MaintainerBot is read-only.
