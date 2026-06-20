import { createAgent, type FlueContext } from '@flue/runtime';
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
// The built-in virtual sandbox replaces just-bash/InMemoryFs, so the agent
// gets `harness.fs` and `harness.shell` for free.

const haikuBot = createAgent(() => ({
  model: 'anthropic/claude-haiku-4-5',
  cwd: '/workspace',
}));

const HaikuResult = v.object({
  theme: v.string(),
  haiku: v.array(v.string()),
  note: v.string(),
});

// Same entry point as before: fire on an inbound webhook carrying { theme }.
export const triggers = { webhook: true };

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
