# HaikuBot — three eras, one bot

Same bot (generate a fresh 5-7-5 haiku on a theme, with a random seed so repeat
calls differ, returning a structured `{ theme, haiku[], note }`), ported across
three frameworks.

| | Original gist (old Flue) | `flue/` (modern Flue) | `eve/` (Eve) |
|---|---|---|---|
| Package | `@flue/sdk/client` | `@flue/runtime` + `@flue/cli` | `eve` + `ai` + `zod` |
| Shape | one `export default async fn` | `createAgent()` + `run` export | a **directory** of files |
| Sandbox | hand-rolled `just-bash` + `InMemoryFs` | built-in virtual sandbox (`harness.fs` / `harness.shell`) | sandbox workspace (managed) |
| Structured output | `valibot` schema on `session.prompt(..., { result })` | same, returned on `response.data` | tool `outputSchema` (Zod) |
| Trigger | `export const triggers = { webhook: true }` | same + `req` on context | HTTP channel on by default; custom `defineChannel` to keep old contract |
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
   `tools/compose_haiku.ts`, `channels/webhook.ts`). Nothing registers anything;
   location is the API.

3. **"Structured output" stops being a prompt argument.** Flue attaches a
   schema to a single `prompt()` call. Eve has no single call to attach to — the
   agent runs an instructions-driven loop — so the typed contract has to live in
   a **tool's `outputSchema`**, and the instructions must tell the model to call
   that tool exactly once. Same guarantee, very different place.

4. **Triggers invert.** Flue is trigger-first: you opt *in* with
   `triggers = { webhook: true }`. Eve is channel-first: HTTP is *already on*,
   and a custom `defineChannel` is only needed to preserve the old "POST a bare
   `{ theme }`" contract.

5. **Small porting hazards are in the spelling, not the structure.** Flue's
   routing strings use dashes (`claude-haiku-4-5`); Eve's docs use dots
   (`claude-haiku-4.5`). And the schema library flips valibot → zod. Easy to
   miss, annoying to debug.

## Honesty about fidelity

These compile-faithfully against the documented APIs, but they were written from
docs, not run against a real install. Two spots are inferred rather than copied
from a published example:

- whether modern Flue still uses `export const triggers = { webhook: true }`
  (the quickstart shows `createAgent` but doesn't restate the trigger syntax);
- Eve's exact `defineChannel` route-handler signature (docs describe
  routes + an `events` map + a `send` call, without a full code sample).

Both are flagged in inline comments in the source.
