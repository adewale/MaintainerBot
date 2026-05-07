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
5. Optionally uses an LLM for richer recommendations.
6. Optionally creates gated draft PRs for allowlisted repos.
7. Writes latest and historic reports to R2.
8. Optionally sends email via Resend.

## Storage

Cloudflare R2 is the durable storage layer.

## Runtime

The agent uses a lightweight `just-bash` sandbox for local scratch files. GitHub API calls happen from trusted runtime code with secrets in env, not from prompts.

## Model routing

If `ANTHROPIC_API_KEY` is configured, MaintainerBot can use:

```txt
anthropic/claude-haiku-4-5
```

If `CLOUDFLARE_ACCOUNT_ID` and `CF_AI_GATEWAY_ID` are also configured, Anthropic traffic is routed through Cloudflare AI Gateway.

## Future remote sandbox

A remote sandbox will be useful when MaintainerBot needs real git clones, dependency installation, and test execution. Until then, API-based scanning keeps the deployed Worker fast and cheap.
