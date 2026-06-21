#!/usr/bin/env bash
# Rebuild the Flue project layout this gist represents, then install.
#
# Gists are flat, so haiku.ts ships at the repo root here. Flue only discovers
# the `haiku` workflow when the file sits at src/workflows/haiku.ts, so recreate
# that path before running.
set -euo pipefail

mkdir -p src/workflows
cp haiku.ts src/workflows/haiku.ts

npm install

cat <<'NEXT'

Done. Set a model key and run:

  export ANTHROPIC_API_KEY=sk-ant-...
  npm run haiku                 # or: npx flue run haiku --payload '{"theme":"autumn rain"}'

Without a key the run reaches the model call and stops at:
  "No API key for provider: anthropic"
NEXT
