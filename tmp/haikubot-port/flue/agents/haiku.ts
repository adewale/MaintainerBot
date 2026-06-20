import { createAgent, type FlueContext } from '@flue/runtime';
import { local } from '@flue/runtime/node';
import * as v from 'valibot';

// HaikuBot — modern Flue port.
//
// The old gist did everything inside one `export default async function`:
// it imported `FlueContext` from '@flue/sdk/client', hand-rolled a sandbox out
// of `just-bash` + `InMemoryFs`, then called `init({ sandbox, cwd, model })`
// to build the agent on the fly.
//
// Modern Flue (`@flue/runtime`, Node >= 22.19) splits those two jobs:
//   1. createAgent(...)  — *describe* the agent (model, cwd, sandbox).
//   2. the `run` export  — *drive* a single invocation via the FlueContext.
//
// Triggering: this is a one-shot "generate a haiku" job, so it's a workflow
// driven from the CLI rather than a webhook. There is no
// `export const triggers = { webhook: true }`; instead you invoke it with
//   npx flue run haiku --payload '{"theme":"autumn rain"}'
// which runs locally without going through HTTP ingress.
//
// Sandbox: `local()` (from @flue/runtime/node) runs the agent against the host
// filesystem under `cwd`, replacing the in-memory virtual sandbox.

const haikuBot = createAgent(() => ({
  model: 'anthropic/claude-haiku-4-5',
  sandbox: local(),
  cwd: '/workspace',
}));

const HaikuResult = v.object({
  theme: v.string(),
  haiku: v.array(v.string()),
  note: v.string(),
});

// CLI-triggered workflow entry point. `payload` comes from
// `flue run haiku --payload '{ "theme": "..." }'`.
export async function run({ init, payload }: FlueContext<{ theme?: string }>) {
  const harness = await init(haikuBot);

  // Mirrors the original `mkdir -p .../haiku && printf <seed> > seed.txt`,
  // but written through the harness fs instead of a raw shell heredoc.
  const seed = crypto.randomUUID();
  await harness.fs.writeFile('haiku/seed.txt', seed);

  const session = await harness.session();
  const response = await session.prompt(
    `Write a fresh original haiku.
Theme: ${payload.theme ?? 'the present moment'}
Random seed: ${seed}
Rules:
- Exactly 3 lines.
- Aim for a 5-7-5 syllable feel.
- Do not reuse previous wording.
- Return only the structured result.`,
    { result: HaikuResult },
  );

  // Flue parses + validates against the valibot schema and hands it back,
  // fully typed, on response.data (the old code returned the raw prompt call).
  return response.data;
}
