import { createAgent } from '@flue/runtime';
import { local } from '@flue/runtime/node';

// HaikuBot as a Flue *agent* (contrast with src/workflows/haiku.ts).
//
// An agent is a file in src/agents/ whose DEFAULT export is createAgent(...).
// Unlike the workflow — a one-shot `run` you call and that returns — this is a
// continuing, addressable instance: you reach a specific conversation by id and
// it keeps context across turns. Reach it via the dev server's HTTP route
//   POST /agents/haiku-chat/<id>
// or interactively with
//   npx flue connect haiku-chat <id>
//
// Same model + local sandbox as the workflow; the difference is purely
// lifecycle (continuing instance vs finite job), so the behaviour that was
// inline in the workflow's prompt() lives here as persistent `instructions`.
export default createAgent(() => ({
  model: 'anthropic/claude-haiku-4-5',
  sandbox: local(),
  cwd: '/workspace',
  instructions: `You are HaikuBot. You write haiku and refine them in conversation.

Rules:
- A haiku is exactly 3 lines, aiming for a 5-7-5 syllable feel.
- When the user gives a theme, write a fresh haiku on it.
- When the user reacts ("more autumnal", "darker", "try again"), REVISE the
  previous haiku rather than starting over — you are one continuing thread.
- Keep the running conversation in mind; don't reuse earlier wording verbatim.`,
}));
