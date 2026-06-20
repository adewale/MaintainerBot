# HaikuBot — three eras, one bot

Same bot (generate a fresh 5-7-5 haiku on a theme, with a random seed so repeat
calls differ, returning a structured `{ theme, haiku[], note }`), ported across
three frameworks.

| | Original gist (old Flue) | `flue/` (modern Flue) | `eve/` (Eve) |
|---|---|---|---|
| Package | `@flue/sdk/client` | `@flue/runtime` + `@flue/cli` | `eve` + `ai` + `zod` |
| File | `haiku.ts` | `src/workflows/haiku.ts` (workflow → `run` export) | `agent/` directory |
| Shape | one `export default async fn` | `createAgent()` + `run` export | a **directory** of files |
| Sandbox | hand-rolled `just-bash` + `InMemoryFs` | **local** sandbox: `local()` from `@flue/runtime/node` | **local** sandbox: `defineSandbox({ backend: justbash() })` |
| Structured output | `valibot` schema on `session.prompt(..., { result })` | same, returned on `response.data` | tool `outputSchema` (Zod) |
| Trigger | `export const triggers = { webhook: true }` | **CLI**: `flue run haiku --payload '{"theme":"…"}'` | **CLI**: dev TUI via `npx eve dev` |
| Schema lib | valibot | valibot | zod |
| Model id | `anthropic/claude-haiku-4-5` | `anthropic/claude-haiku-4-5` | `anthropic/claude-haiku-4.5` (dots!) |

## Run results (actually executed, 2026-06-20)

All were installed from the real npm packages (`@flue/runtime` → withastro/flue,
`eve` → vercel/eve, `@flue/sdk` + `just-bash` → vercel-labs) and run. No model
credentials were available in the sandbox, so none could emit a real haiku — but
the three modern artifacts each executed cleanly right up to the model call.

The deliverable is **three artifacts** (plus the museum-piece original):

| Artifact | File | Driven by | Result |
|---|---|---|---|
| **Flue workflow** | `flue/src/workflows/haiku.ts` (exports `run`) | `flue run haiku --target node` | ✓ discovered in `src/workflows/`, got a runId, ran to the prompt → `No API key for provider: anthropic` |
| **Flue agent** | `flue/src/agents/haiku-chat.ts` (default `createAgent`) | `flue connect haiku-chat <id>` | ✓ discovered in `src/agents/`, connected, processed the submission → `No API key for provider: anthropic` |
| **Eve agent** | `eve/agent/` (directory) | `POST /eve/v1/session` on the built server | ✓ compiled 0 errors, full session lifecycle streamed → `MODEL_CALL_FAILED` (AI Gateway 401) |
| _original (old Flue)_ | `original/haiku.ts` | _n/a_ | ✗ `import '@flue/sdk/client'` → `ERR_PACKAGE_PATH_NOT_EXPORTED`; today's `@flue/sdk` exports `createFlueClient` (an HTTP client), not the `FlueContext`/`init` the gist needs. Entry shape matches no current runtime. |

The Flue **workflow** vs **agent** split is the same distinction discussed
elsewhere in this repo: a workflow is a one-shot `run` you invoke and that
returns; an agent is a continuing instance you address by id (`haiku-chat/<id>`)
and converse with. Same model + local sandbox; different lifecycle.

Running it surfaced a **real bug the docs-only version had**: Eve's just-bash
backend import is `eve/sandbox/just-bash` (hyphenated), not `eve/sandbox/justbash`.
Eve also hard-requires Node >= 24 (Flue is happy on 22.19+).

Net: "structurally correct, blocked only on credentials" for the two modern
ports; the original is a museum piece — kept for the run attempt, not buildable.

## Is there code reuse between the three?

Essentially **none at the code level** — they are three independent projects with
separate `package.json`s, dependency trees, and framework APIs; nothing is
imported across them. What's actually shared is *content*, not *code*:

- **The prompt string** (`Write a fresh original haiku… 5-7-5… Random seed…`) is
  copy-pasted verbatim into all three. This is the only literal reuse.
- **The output contract** `{ theme, haiku[], note }` is re-declared in each:
  valibot in the original and in `flue/`, **zod** in `eve/`. Same shape, three
  declarations, two libraries.
- **The model id** is the same model, spelled `claude-haiku-4-5` (Flue) vs
  `claude-haiku-4.5` (Eve).

Everything structural — how the agent is described, how it's triggered, how the
sandbox is wired, how structured output is captured — is framework-specific and
cannot be shared. The orchestration in `flue/` (a `run` export that `init`s an
agent and calls `prompt(..., { result })`) has no counterpart in `eve/`, where
the same job is spread across `agent.ts` + `instructions.md` + a tool's
`outputSchema`. The portable surface of "the same bot" turned out to be just a
prompt and a data shape; the wiring doesn't travel.

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

Originally written from docs; since **actually installed and run** (see Run
results above), which resolved both previously-inferred spots:

- the `flue run haiku --target node` ↔ `src/workflows/` discovery wiring is
  **confirmed** — the CLI found and ran the workflow;
- Eve's backend import was **wrong** in the docs-only version
  (`eve/sandbox/justbash`) and is now fixed to the real subpath
  `eve/sandbox/just-bash`, verified against eve@0.11.8's package exports.

Remaining unverified: neither modern port produced an actual haiku, because the
sandbox had no model credentials (Anthropic key for Flue; Vercel AI Gateway
token for Eve). Both reached the model call and failed only on auth.
