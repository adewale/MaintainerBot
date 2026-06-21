# Gist-ready bundles

Each subfolder is one self-contained gist for one artifact. The files inside are
flat (gist filenames), exactly what you'd paste into a secret gist. A `setup.sh`
in each restores the directory layout the framework needs, because gists cannot
hold subdirectories.

| Bundle | Artifact | Flat files | Runs with |
|---|---|---|---|
| `flue-workflow/` | Flue workflow | `haiku.ts`, `flue.config.ts`, `package.json`, `setup.sh` | `npm run haiku` |
| `flue-agent/` | Flue agent | `haiku-chat.ts`, `flue.config.ts`, `package.json`, `setup.sh` | `npm run chat` |
| `eve-agent/` | Eve agent | `agent.ts`, `instructions.md`, `compose_haiku.ts`, `sandbox.ts`, `package.json`, `setup.sh` | `npx eve dev` |

Each bundle's own `README.md` lists the per-file destination and the exact
create/run commands.

## Two caveats before you publish

1. **"Secret" gists are not private.** They are unlisted, not access-controlled:
   anyone with the URL can read them. For genuine privacy, use a private repo.
2. **Gists can't store directories.** Flue needs one file moved into
   `src/{workflows,agents}/`; Eve needs four files rebuilt into `agent/…`. The
   `setup.sh` scripts handle this, so the gists are runnable only *after*
   running setup, not by pointing a tool straight at the gist. If you want
   clone-and-run with no setup step, a private repo (which preserves the tree)
   is the better home — especially for the Eve agent.

## Creating the gists

This session cannot create gists (no `gh`, and the GitHub tools here are scoped
to one repo with no gist endpoint). To publish, either:

- paste each bundle's files into a new secret gist in the web UI, or
- from a machine with `gh` (a token with `gist` scope), run the
  `gh gist create --secret …` command printed in each bundle's README.
