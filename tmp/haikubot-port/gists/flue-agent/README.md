# HaikuBot — Flue agent (gist)

A continuing Flue agent: address an instance by id (`haiku-chat/<id>`) and
refine haiku across turns. Unlike the workflow, it keeps per-id conversation
state instead of returning once.

## Files in this gist

| File | Goes to | Purpose |
|---|---|---|
| `haiku-chat.ts` | `src/agents/haiku-chat.ts` | the agent (default `createAgent`) |
| `flue.config.ts` | repo root | sets `target: 'node'` |
| `package.json` | repo root | pinned deps + `npm run chat` |
| `setup.sh` | repo root | recreates the layout, runs `npm install` |

Gists are flat, so `haiku-chat.ts` lives at the root here. Flue discovers an
agent only at `src/agents/<name>.ts`, which is why `setup.sh` moves it there.

## Run it

```bash
git clone <this-gist-url> haikubot-flue-agent && cd haikubot-flue-agent
bash setup.sh
export ANTHROPIC_API_KEY=sk-ant-...
npm run chat
```

Enter one prompt per line; the instance id holds the running thread. Without a
key the agent reaches the model call and stops at
`No API key for provider: anthropic`.

## Create the gist

Web: new secret gist, paste each file above under its listed filename.

CLI (needs `gh` with `gist` scope):
```bash
gh gist create --secret haiku-chat.ts flue.config.ts package.json setup.sh README.md
```

Note: a GitHub "secret" gist is unlisted, not access-controlled — anyone with
the URL can read it. For real privacy use a private repo instead.
