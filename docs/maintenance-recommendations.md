# Review maintenance recommendations

The shared instructions in `src/agents/report-analyst.ts` apply to project audits
and run synthesis. The supplied context includes open PR metadata and rejected
fingerprints; it may not include PR diffs or rejection rationale. Missing evidence
should produce a specific investigation rather than a claim that work overlaps.

Use these scenarios when reviewing model output:

| Supplied evidence | Expected recommendation |
| --- | --- |
| An open PR removes the same duplicate branch validation, with matching diff evidence | Review or extend that PR; cite its overlap rather than propose another |
| A PR title says “CI cleanup” with no diff | Inspect that PR's diff before deciding it covers the finding |
| Rejected fingerprint with no new facts | Omit the rejected proposal |
| Two jobs have similar commands but distinct release events or permissions | Preserve them unless equivalent coverage is demonstrated |
| An incident exposed webhook admission failure | Prefer a regression check at the admission boundary; another schedule needs a separate reason |
| No supported actionable issue | Empty recommendation and candidate arrays are valid |

An owning boundary means an existing command, workflow, or module, not an invented
person or team. These instructions guide the model; they do not mechanically prove
that its recommendations are correct. The bot remains read-only.

Project audits generated under an older or unknown prompt version are refreshed on the next
model-enabled run, even if repository inputs have not changed. Without model
credentials the existing context-only path can still display historical audits
with their recorded prompt version. This PR does not deploy the bot or rewrite
the persisted lessons ledger.
