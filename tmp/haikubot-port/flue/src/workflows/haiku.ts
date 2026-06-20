import { createAgent, type FlueContext } from '@flue/runtime';
import { local } from '@flue/runtime/node';
import * as v from 'valibot';

// HaikuBot — modern Flue port.
//
// The old gist packed everything into one `export default async function`: it
// imported `FlueContext` from '@flue/sdk/client', built a sandbox from
// `just-bash` + `InMemoryFs`, then called `init({ sandbox, cwd, model })`.
//
// Modern Flue (`@flue/runtime`, Node >= 22.19) splits that into two exports:
//   1. createAgent(...): the agent's config (model, cwd, sandbox).
//   2. run(...): one invocation, receiving the agent via FlueContext.
//
// This file exports run(), so Flue treats it as a workflow and requires it
// under src/workflows/. An agent would be a default createAgent export under
// src/agents/. Flue reads the folder name to decide which it is.
//
// No `export const triggers = { webhook: true }`: a workflow is reached by
// `npx flue run haiku --payload '{"theme":"autumn rain"}'`, which invokes run()
// directly without registering an HTTP route.
//
// `local()` (from @flue/runtime/node) executes shell and fs against the host
// filesystem under `cwd`, in place of the default in-memory sandbox.

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
