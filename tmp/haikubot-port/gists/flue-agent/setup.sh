#!/usr/bin/env bash
# Rebuild the Flue project layout this gist represents, then install.
#
# Gists are flat, so haiku-chat.ts ships at the repo root here. Flue discovers
# an agent only at src/agents/<name>.ts, so recreate that path before running.
set -euo pipefail

mkdir -p src/agents
cp haiku-chat.ts src/agents/haiku-chat.ts

npm install

cat <<'NEXT'

Done. Set a model key and open a conversation instance:

  export ANTHROPIC_API_KEY=sk-ant-...
  npm run chat                  # or: npx flue connect haiku-chat <some-id>

Type one prompt per line ("a haiku about dawn", then "make it lonelier"); the
<id> keeps the thread. Without a key it reaches the model call and stops at:
  "No API key for provider: anthropic"
NEXT
