// Verbatim recreation of the original gist (old Flue) for the run attempt.
import type { FlueContext } from '@flue/sdk/client';
import { Bash, InMemoryFs } from 'just-bash';
import * as v from 'valibot';

export const triggers = { webhook: true };

export default async function ({ init, payload }: FlueContext) {
  const fs = new InMemoryFs();
  const sandbox = () => new Bash({ fs, cwd: '/workspace' });
  const agent = await init({
    sandbox,
    cwd: '/workspace',
    model: 'anthropic/claude-haiku-4-5',
  });
  const session = await agent.session();
  const seed = crypto.randomUUID();
  await session.shell(`mkdir -p /workspace/haiku && printf ${JSON.stringify(seed)} > /workspace/haiku/seed.txt`);
  return await session.prompt(
    `Write a fresh original haiku.
Theme: ${payload.theme ?? 'the present moment'}
Random seed: ${seed}
Rules:
- Exactly 3 lines.
- Aim for a 5-7-5 syllable feel.
- Do not reuse previous wording.
- Return only the structured result.`,
    {
      result: v.object({
        theme: v.string(),
        haiku: v.array(v.string()),
        note: v.string(),
      }),
    },
  );
}
