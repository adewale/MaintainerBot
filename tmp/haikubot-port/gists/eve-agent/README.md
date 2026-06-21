# HaikuBot — Eve agent (gist)

An Eve agent: given a theme, write a 5-7-5 haiku and return it through a tool
with a typed `{ theme, haiku[], note }` output. In Eve the agent is a directory
of files, discovered by path.

## Files in this gist

| File | Goes to | Purpose |
|---|---|---|
| `agent.ts` | `agent/agent.ts` | model config |
| `instructions.md` | `agent/instructions.md` | system prompt |
| `compose_haiku.ts` | `agent/tools/compose_haiku.ts` | structured output (zod `outputSchema`) |
| `sandbox.ts` | `agent/sandbox.ts` | local `justbash()` backend |
| `package.json` | repo root | pinned deps (`eve`, `ai`, `zod`) |
| `setup.sh` | repo root | rebuilds the `agent/` tree, runs `npm install` |

**Why `setup.sh` is required here.** Eve resolves capabilities by path, but
gists are flat and cannot store `agent/tools/compose_haiku.ts`. The four source
files ship at the root and `setup.sh` restores the directory layout. The Flue
gists need the same trick for one file; Eve needs it for four, which is why a
directory-preserving private repo is the better home if you plan to run it.

## Run it

```bash
git clone <this-gist-url> haikubot-eve-agent && cd haikubot-eve-agent
bash setup.sh                       # needs Node >= 24
npx eve link                        # or: export AI_GATEWAY_API_KEY=...
npx eve dev
```

Eve's default model routes through the Vercel AI Gateway. Without a token the
session reaches the model call and stops at `MODEL_CALL_FAILED — AI Gateway
received no credentials`.

## Create the gist

Web: new secret gist, paste each file above under its listed filename.

CLI (needs `gh` with `gist` scope):
```bash
gh gist create --secret agent.ts instructions.md compose_haiku.ts sandbox.ts package.json setup.sh README.md
```

Note: a GitHub "secret" gist is unlisted, not access-controlled — anyone with
the URL can read it, and it cannot preserve the `agent/` directory. For a
private, runnable copy use a private repo instead.
