// HaikuBot — Flue AGENT (single-file reading copy)
//
// One of three sibling gists: Flue workflow, Flue agent, Eve agent. This file
// concatenates every part of the Flue *agent* artifact so you can read the whole
// thing in one place. It is NOT meant to compile or run — each section below is
// a separate file in a real project, marked by a boxed FILE banner.
//
// What it is: a continuing conversation. You address an instance by id
// (haiku-chat/<id>) and refine haiku across turns; Flue persists the per-id
// session history. Contrast the workflow gist, which runs once and returns.


// ============================================================================
// ===  FILE 1/3  —  src/agents/haiku-chat.ts   (the agent)
// ============================================================================

import { createAgent } from '@flue/runtime';
import { local } from '@flue/runtime/node';

// HaikuBot as a Flue agent. Compare src/workflows/haiku.ts, which exports run().
//
// An agent is a file in src/agents/ whose default export is createAgent(...).
// Flue serves it at POST /agents/haiku-chat/<id>; each <id> is its own
// conversation whose session history Flue persists, so turn N sees turns 1..N-1.
// A workflow keeps no such state: run() executes once and returns a value.
//
// Run a local instance: npx flue connect haiku-chat <id>
//
// Model and sandbox match the workflow. Because the reply depends on earlier
// turns, the rules the workflow passed inline to prompt() are persistent
// `instructions` here instead.
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


// ============================================================================
// ===  FILE 2/3  —  flue.config.ts   (build target)
// ============================================================================

import { defineConfig } from '@flue/cli/config';

export default defineConfig({ target: 'node' });


// ============================================================================
// ===  FILE 3/3  —  package.json   (JSON, not TypeScript — shown for context)
// ============================================================================
/*
{
  "name": "haikubot-flue-agent",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22.19.0"
  },
  "scripts": {
    "chat": "flue connect haiku-chat local"
  },
  "dependencies": {
    "@flue/runtime": "^1.0.0-beta.2"
  },
  "devDependencies": {
    "@flue/cli": "^1.0.0-beta.1"
  }
}
*/
