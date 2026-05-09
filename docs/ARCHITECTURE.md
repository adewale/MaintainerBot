# MaintainerBot Architecture

## Core Flue agent

```txt
.flue/agents/daily-maintenance.ts
```

The agent:

1. Validates the protected webhook secret.
2. Loads durable memory from R2.
3. Scans GitHub repositories, issues, and PRs.
4. Builds deterministic recommendations with stable fingerprints.
5. Builds per-project context, including repo health, issues, PRs, deterministic findings, and root TODO files.
6. Optionally uses an LLM for richer per-project recommendations from that context.
6. Optionally creates gated draft PRs for allowlisted repos.
7. Writes the living status page, latest aliases, and historic reports to R2.
8. Optionally sends email via Cloudflare Email Routing.

## Storage

Cloudflare R2 is the durable storage layer.

Primary latest status objects:

```txt
MaintainerBotOut.md
MaintainerBotOut.json
```

Latest aliases:

```txt
reports/daily-maintenance-latest.md
reports/daily-maintenance-latest.json
```

Historic snapshots:

```txt
reports/history/YYYY-MM-DD/daily-maintenance.md
reports/history/YYYY-MM-DD/daily-maintenance.json
```

## Runtime

The agent uses a lightweight `just-bash` sandbox for local scratch files. GitHub API calls happen from trusted runtime code with secrets in env, not from prompts.

## LLM context

When model credentials exist, the agent passes structured project contexts to the LLM. Each context includes repository metadata, health signals, open TODOs from root TODO files, open issues, open PRs, and deterministic findings. Secrets are not included.

## Model routing

If `ANTHROPIC_API_KEY` is configured, MaintainerBot can use:

```txt
anthropic/claude-haiku-4-5
```

If `CLOUDFLARE_ACCOUNT_ID` and `CF_AI_GATEWAY_ID` are also configured, Anthropic traffic is routed through Cloudflare AI Gateway.

## Future remote sandbox

A remote sandbox will be useful when MaintainerBot needs real git clones, dependency installation, and test execution. Until then, API-based scanning keeps the deployed Worker fast and cheap.
