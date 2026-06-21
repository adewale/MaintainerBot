# HaikuBot — Flue workflow (gist)

A one-shot Flue workflow: given a theme, generate a 5-7-5 haiku and return a
structured `{ theme, haiku[], note }`. Invoked from the CLI, runs once, returns.

## Files in this gist

| File | Goes to | Purpose |
|---|---|---|
| `haiku.ts` | `src/workflows/haiku.ts` | the workflow (`run` export) |
| `flue.config.ts` | repo root | sets `target: 'node'` |
| `package.json` | repo root | pinned deps + `npm run haiku` |
| `setup.sh` | repo root | recreates the layout, runs `npm install` |

Gists are flat, so `haiku.ts` lives at the root here. Flue discovers a workflow
only at `src/workflows/<name>.ts`, which is why `setup.sh` moves it into place.

## Run it

```bash
git clone <this-gist-url> haikubot-flue-workflow && cd haikubot-flue-workflow
bash setup.sh
export ANTHROPIC_API_KEY=sk-ant-...
npm run haiku
```

Flue reads `ANTHROPIC_API_KEY` (the provider's conventional var). Without it the
run reaches the model call and stops at `No API key for provider: anthropic`.

## Create the gist

Web: new secret gist, paste each file above under its listed filename.

CLI (needs `gh` with `gist` scope):
```bash
gh gist create --secret haiku.ts flue.config.ts package.json setup.sh README.md
```

Note: a GitHub "secret" gist is unlisted, not access-controlled — anyone with
the URL can read it. For real privacy use a private repo instead.
