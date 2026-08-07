# MaintainerBot Lessons Learned

This document captures durable lessons from designing and operating MaintainerBot.

## 1. LLMs synthesize; deterministic code discovers facts

MaintainerBot should use deterministic loaders for source-of-truth facts:

- GitHub repo metadata
- open issues and PRs
- root TODO files
- repo health signals
- R2 memory
- context/audit history

The LLM should interpret those facts into a daily handoff. It should not be responsible for discovering or inventing facts.

## 2. No-LLM mode should still be useful

If no model key is configured, MaintainerBot should emit a degraded `context-only-no-model` report, not fail and not pretend to provide synthesized analysis.

Useful no-LLM output includes:

- open issues
- stale/open PRs
- TODO-backed context
- project context refs
- repo health gaps
- clear notice that no LLM synthesis ran

## 3. Replay is first-class

Running the bot again is not replay.

Replay means feeding the exact stored context bundle from a previous run into an agent/model again without re-fetching GitHub or rebuilding facts.

Replay enables:

- same context, different model
- same context, different prompt
- same context, different agent
- debugging whether a bad recommendation came from facts, prompt, or model behavior

## 4. Context bundles are the core artifact

The key pipeline is:

```txt
deterministic facts → durable context bundle → bounded LLM call → structured output
```

This is better than one giant prompt with hidden state.

Durable bundles should be stored in R2 so they can be inspected, replayed, and compared.

## 5. Use cheap fingerprints before expensive context building

Do not rebuild every project context every day.

Use a cheap project state fingerprint first:

```txt
repo metadata + issue/PR updated_at + memory hash → state fingerprint
```

If unchanged:

```txt
reuse previous context bundle and previous project audit
```

If changed:

```txt
rebuild context and optionally run a fresh project LLM audit
```

## 6. MaintainerBot is read-only

MaintainerBot must not mutate GitHub.

Forbidden:

- branches
- commits
- PRs
- comments
- labels
- issue edits
- releases
- repository settings changes

The bot can recommend actions and verification steps. Humans apply changes.

## 7. Phase 1 is surface audit only

Phase 1 should not clone repos, run tests, run evals, or invoke coding agents against checkouts.

Phase 1 produces:

- deterministic surface facts
- context bundles
- project audits when LLM is configured
- daily handoff

Later phases can add checkout/eval/coding-agent evidence artifacts, but they should not change the Phase 1 contract.

## 8. Sandcastle/Flue lesson

The common primitive across hosted agents and repo workflows is not simply “agent.”

It is:

```txt
bounded work step over explicit context, producing durable artifacts
```

For MaintainerBot, the durable artifacts are:

- project context bundles
- run context bundles
- project audits
- status reports

## 9. Hosted agents and repo workflows need different capabilities

Hosted Worker agents are good at:

- scheduled/webhook runs
- R2 memory
- GitHub API reads
- status publishing
- LLM synthesis

Repo workflow agents are good at:

- checkout
- file inspection
- tests/builds/evals
- coding-agent experiments

Context bundles are the bridge between the two.

## 10. Store enough metadata for future comparison

Each LLM output should eventually record:

- run ID
- context bundle key
- input hash
- prompt version
- model
- schema version
- output
- validation result
- timestamp

This makes model/prompt comparisons meaningful.

## 11. Degraded reports should be honest

If no LLM ran, the report should say so prominently.

The status page should distinguish:

```txt
context-only facts
```

from:

```txt
LLM-synthesized recommendations
```

## 12. Use a read-only GitHub token

Unauthenticated GitHub API calls can hit rate limits from Cloudflare egress IPs.

MaintainerBot should use a least-privileged read-only GitHub token when deployed.

## 13. Output should stay action-first

The status page should put actionable human decisions first:

- security-ish issues
- stale PRs
- open PRs needing review
- TODO-backed work
- high-signal repo health gaps

Low-value metadata nags should not dominate the top of the report.

## 14. R2 is the durable memory layer

All durable MaintainerBot state should live in R2, including:

```txt
contexts/index.json
contexts/runs/<runId>.json
contexts/projects/<owner>__<repo>/latest.json
audits/projects/<owner>__<repo>/latest.json
MaintainerBotOut.md
MaintainerBotOut.json
```

## 15. Treat pre-1.0 Flue durable stores as reset-only operational state

Flue beta storage schemas can change incompatibly. When upgrading Flue, validate Cloudflare Durable Object storage paths, not just the workflow result.

For the beta.9 upgrade, the workflow completed but Wrangler tail exposed that `FlueRegistry` still had an old schema marker:

```txt
This database records an unrecognized schema version ("1"; this runtime supports version 4).
```

That meant run registry/history bookkeeping was unhealthy even though the daily report path worked. Always tail after deploy and watch Flue internal Durable Objects such as `FlueRegistry`, workflow DOs, and agent DOs.

## 16. Reset Cloudflare Durable Object storage deliberately, then redeploy normal code

Cloudflare migrations are not a general-purpose data reset tool. A migration that deletes and recreates the same Durable Object class in one history failed with:

```txt
class 'FlueRegistry' cannot be the target of more than one migration
```

For a reset-only Flue beta schema break, the safe operational pattern was:

1. Build the normal Worker.
2. Temporarily patch only the generated `FlueRegistry` class in `dist` to drop Flue registry tables/meta from inside the Durable Object.
3. Deploy the temporary bundle.
4. Trigger the registry once so the singleton DO clears its own SQLite state.
5. Immediately redeploy the normal generated Worker.
6. Verify `FlueRegistry` `/start` and `/end` calls return `204` with `outcome: ok` in Wrangler tail.

Do not commit the temporary reset shim. Record the reset in operations notes because old run registry/history pointers are intentionally discarded.
