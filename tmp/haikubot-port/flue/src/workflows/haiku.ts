import { createAgent, type FlueContext } from '@flue/runtime';
import { local } from '@flue/runtime/node';
import * as v from 'valibot';

// HaikuBot as a Flue workflow.
//
// Flue keeps an agent's config separate from a single invocation:
//   1. createAgent(...): the model, cwd, and sandbox.
//   2. run(...): one invocation, receiving the agent via FlueContext.
//
// This file exports run(), so Flue treats it as a workflow and requires it
// under src/workflows/. A default createAgent export under src/agents/ would be
// an agent instead; Flue reads the folder name to decide.
//
// A workflow is reached by `npx flue run haiku --payload '{"theme":"autumn rain"}'`,
// which invokes run() directly without registering an HTTP route.
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

  // Persist a per-run seed in the workspace and pass it into the prompt below,
  // so repeated runs don't converge on the same haiku.
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
  // fully typed, on response.data.
  return response.data;
}
