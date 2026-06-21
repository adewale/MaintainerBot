#!/usr/bin/env bash
# Rebuild the Eve agent/ tree this gist represents, then install.
#
# Eve discovers capabilities by path (agent/agent.ts, agent/instructions.md,
# agent/tools/*.ts, agent/sandbox.ts). Gists are flat and cannot hold those
# subdirectories, so the files ship at the root and this script restores the
# tree. Requires Node >= 24.
set -euo pipefail

mkdir -p agent/tools
cp agent.ts            agent/agent.ts
cp instructions.md     agent/instructions.md
cp sandbox.ts          agent/sandbox.ts
cp compose_haiku.ts    agent/tools/compose_haiku.ts

npm install

cat <<'NEXT'

Done. Provide credentials (one of):
  npx eve link                      # pull a Vercel AI Gateway token (VERCEL_OIDC_TOKEN)
  export AI_GATEWAY_API_KEY=...      # or set a gateway key directly

Then start it:
  npx eve dev                       # interactive TUI
  # or POST to the HTTP session API once running

Without credentials the session reaches the model call and stops at:
  MODEL_CALL_FAILED — "AI Gateway received no credentials"
NEXT
