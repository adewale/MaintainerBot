# HaikuBot — three eras, one bot

Same bot (generate a fresh 5-7-5 haiku on a theme, with a random seed so repeat
calls differ, returning a structured `{ theme, haiku[], note }`), ported across
three frameworks.

| | Original gist (old Flue) | `flue/` (modern Flue) | `eve/` (Eve) |
|---|---|---|---|
| Package | `@flue/sdk/client` | `@flue/runtime` + `@flue/cli` | `eve` + `ai` + `zod` |
| Shape | one `export default async fn` | `createAgent()` + `run` export | a **directory** of files |
| Sandbox | hand-rolled `just-bash` + `InMemoryFs` | **local** sandbox: `local()` from `@flue/runtime/node` | **local** sandbox: `defineSandbox({ backend: justbash() })` |
| Structured output | `valibot` schema on `session.prompt(..., { result })` | same, returned on `response.data` | tool `outputSchema` (Zod) |
| Trigger | `export const triggers = { webhook: true }` | **CLI**: `flue run haiku --payload '{"theme":"…"}'` | **CLI**: dev TUI via `npx eve dev` |
| Schema lib | valibot | valibot | zod |
| Model id | `anthropic/claude-haiku-4-5` | `anthropic/claude-haiku-4-5` | `anthropic/claude-haiku-4.5` (dots!) |

## What we learned

1. **Modern Flue is the same idea, refactored, not reinvented.** The old gist
   fused "what the agent is" and "how this call runs" into one function and
   bolted on its own sandbox. Modern Flue separates those (`createAgent` vs the
   `run` export) and ships the sandbox in the box — so the `just-bash` /
   `InMemoryFs` plumbing and the `@flue/sdk/client` import just disappear. The
   actual haiku prompt + valibot schema port over almost verbatim.

2. **Eve is a different mental model, not a different API.** You don't write a
   function that builds an agent; you lay out a directory and Eve *is* the
   agent. Instructions, the model, the structured contract, and the trigger
   each move to their own file (`instructions.md`, `agent.ts`,
   `tools/compose_haiku.ts`, `sandbox.ts`). Nothing registers anything;
   location is the API.

3. **"Structured output" stops being a prompt argument.** Flue attaches a
   schema to a single `prompt()` call. Eve has no single call to attach to — the
   agent runs an instructions-driven loop — so the typed contract has to live in
   a **tool's `outputSchema`**, and the instructions must tell the model to call
   that tool exactly once. Same guarantee, very different place.

4. **CLI triggering looks different in each.** Flue treats a one-shot job as a
   *workflow*: drop the webhook trigger entirely and run
   `npx flue run haiku --payload '{"theme":"…"}'`, which executes locally
   without HTTP ingress. Eve has no one-shot run command — its CLI surface is
   the interactive **dev TUI** (`npx eve dev`), where you type a message and
   watch the agent work. (The HTTP channel stays on by default, but it's no
   longer the intended entry point, so the custom webhook channel is gone.)

5. **"Local sandbox" is one call in both — and circles back to the original.**
   Flue: `sandbox: local()` from `@flue/runtime/node` runs against the host FS.
   Eve: `defineSandbox({ backend: justbash() })` pins the pure-local in-process
   backend — which is the very same `just-bash` engine the 2024 gist wired up
   by hand. The frameworks absorbed what HaikuBot used to do manually.

6. **Small porting hazards are in the spelling, not the structure.** Flue's
   routing strings use dashes (`claude-haiku-4-5`); Eve's docs use dots
   (`claude-haiku-4.5`). And the schema library flips valibot → zod. Easy to
   miss, annoying to debug.

## Honesty about fidelity

These compile-faithfully against the documented APIs, but they were written from
docs, not run against a real install. Two spots are inferred rather than copied
from a published example:

- the exact `flue run <name>` ↔ workflow-`run`-export wiring (the CLI docs show
  `flue run <workflow> --payload …`, and a CLI-invoked workflow doesn't need a
  webhook trigger, but the docs don't show this specific agent file run that
  way);
- Eve's `eve/sandbox/justbash` import path (extrapolated from the documented
  `eve/sandbox/docker` pattern; `justbash` is listed as an available local
  backend but without an import example).

Both are flagged in inline comments in the source.
