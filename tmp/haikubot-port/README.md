# HaikuBot — Flue and Eve

Two implementations of one bot: generate a fresh 5-7-5 haiku on a theme, with a
random seed so repeated calls differ, returning a structured
`{ theme, haiku[], note }`. One is built in Flue, one in Eve.

| | `flue/` (Flue) | `eve/` (Eve) |
|---|---|---|
| Packages | `@flue/runtime` + `@flue/cli` | `eve` + `ai` + `zod` |
| Layout | files under `src/agents/` and `src/workflows/` | an `agent/` directory |
| Shape | `createAgent()` config + a `run` export | files Eve maps by path |
| Sandbox | `local()` from `@flue/runtime/node` | `defineSandbox({ backend: justbash() })` |
| Structured output | valibot schema on `session.prompt(..., { result })` | a tool's `outputSchema` (zod) |
| CLI entry | `flue run haiku` / `flue connect haiku-chat <id>` | `npx eve dev` TUI, or `POST /eve/v1/session` |
| Schema lib | valibot | zod |
| Model id | `anthropic/claude-haiku-4-5` | `anthropic/claude-haiku-4.5` (a dot) |
| Min Node | 22.19 | 24 |

## Three artifacts

Flue separates a workflow (a `run` export, one finite invocation that returns)
from an agent (a default `createAgent`, a continuing instance addressed by id).
This port carries both, alongside the Eve agent:

| Artifact | File | Driven by |
|---|---|---|
| **Flue workflow** | `flue/src/workflows/haiku.ts` | `flue run haiku --payload '{"theme":"…"}'` |
| **Flue agent** | `flue/src/agents/haiku-chat.ts` | `flue connect haiku-chat <id>` |
| **Eve agent** | `eve/agent/` | `POST /eve/v1/session` (or the `eve dev` TUI) |

## Run results (executed 2026-06-20)

Installed from the published packages (`@flue/runtime` → withastro/flue, `eve` →
vercel/eve) and run. The sandbox had no model credentials, so none emitted a
haiku; each reached the model call and stopped there.

| Artifact | Result |
|---|---|
| Flue workflow | ✓ discovered in `src/workflows/`, got a runId, ran to the prompt → `No API key for provider: anthropic` |
| Flue agent | ✓ discovered in `src/agents/`, connected, processed the submission → `No API key for provider: anthropic` |
| Eve agent | ✓ compiled 0 errors, full session lifecycle streamed → `MODEL_CALL_FAILED` (AI Gateway 401) |

Running the Eve port caught a real bug: the just-bash backend import is
`eve/sandbox/just-bash` (hyphenated); `eve/sandbox/justbash` throws
`ERR_PACKAGE_PATH_NOT_EXPORTED`. Eve requires Node >= 24; Flue runs on 22.19+.

## Is there code reuse between the artifacts?

None at the code level: three artifacts across two projects, with separate
`package.json` files and APIs, and nothing imported across them. What recurs is
data and prose, re-expressed for each surface:

- The output shape `{ theme, haiku[], note }` is declared with valibot in the
  Flue workflow and with zod in the Eve tool. The Flue agent states it in prose.
- The haiku rules (3 lines, 5-7-5, don't reuse wording) appear in all three,
  reworded per surface rather than copied.
- The model is the same, spelled `claude-haiku-4-5` (Flue) and
  `claude-haiku-4.5` (Eve).

How the agent is described, triggered, and sandboxed, and how structured output
is captured, is framework-specific. The Flue workflow's `run` export that inits
an agent and calls `prompt(..., { result })` has no Eve counterpart; Eve spreads
the same job across `agent.ts`, `instructions.md`, and `tools/compose_haiku.ts`.
The portable surface is a data shape and a few rules; the wiring does not
transfer.

## What we learned

1. **Flue splits config from invocation.** `createAgent(...)` holds the model,
   cwd, and sandbox; a `run` export drives one call through the FlueContext. The
   folder sets the role: a `run` export under `src/workflows/`, a default
   `createAgent` export under `src/agents/`.

2. **Eve makes the directory the agent.** The model is `agent.ts`, the system
   prompt is `instructions.md`, structured output is a tool under `tools/`, the
   sandbox is `sandbox.ts`. Eve maps each by path, so nothing registers anything.

3. **Structured output attaches in different places.** Flue passes a valibot
   schema to one `prompt()` call and reads `response.data`. Eve has no single
   call to attach to: the agent runs a message loop, so the zod schema lives on
   a tool's `outputSchema`, and `instructions.md` tells the model to call that
   tool once.

4. **CLI entry differs by shape.** A Flue workflow runs once:
   `flue run haiku --payload '{"theme":"…"}'` invokes `run()` without an HTTP
   route. A Flue agent is a conversation: `flue connect haiku-chat <id>`. Eve's
   CLI is the `npx eve dev` TUI, with the HTTP session API
   (`POST /eve/v1/session`) staying on for non-interactive calls.

5. **The local sandbox is one call each.** Flue: `sandbox: local()` from
   `@flue/runtime/node` runs shell and fs against the host. Eve:
   `defineSandbox({ backend: justbash() })` runs just-bash in-process, needing
   no Docker daemon and no network.

6. **Two spellings to watch.** The model id uses dashes in Flue
   (`claude-haiku-4-5`) and a dot in Eve (`claude-haiku-4.5`); the gateway
   resolves that string at the model call, so a wrong spelling fails at runtime,
   not at compile time. The schema library also flips: valibot in Flue, zod in
   Eve.

## Fidelity

Written from docs, then installed and run. The run confirmed the
`flue run haiku --target node` ↔ `src/workflows/` discovery and corrected the
Eve backend import to `eve/sandbox/just-bash` (checked against eve@0.11.8).
Unverified: neither port produced an actual haiku, because the sandbox had no
model credentials (an Anthropic key for Flue, a Vercel AI Gateway token for
Eve). Both reached the model call and failed only on auth.
