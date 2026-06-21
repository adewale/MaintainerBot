// HaikuBot — EVE AGENT (single-file reading copy)
//
// One of three sibling gists: Flue workflow, Flue agent, Eve agent. This file
// concatenates every part of the Eve *agent* artifact so you can read the whole
// thing in one place. It is NOT meant to compile or run — each section below is
// a separate file in an Eve `agent/` directory, marked by a boxed FILE banner.
//
// What it is: in Eve the agent IS a directory; Eve discovers capabilities by
// path. The model is agent.ts, the system prompt is instructions.md, structured
// output is a tool under tools/, and the sandbox is sandbox.ts. There is no
// single run()/prompt() call as in Flue — Eve runs a message loop, so the typed
// output contract lives on a tool's outputSchema and the prompt tells the model
// to call it once. Reading order below follows how a turn flows.


// ============================================================================
// ===  FILE 1/5  —  agent/agent.ts   (model config)
// ============================================================================

import { defineAgent } from "eve";

// In Eve the agent is the agent/ directory, not this file. agent.ts holds the
// config that has no other home: here, the model. The system prompt is
// instructions.md, tools are tools/*.ts, the sandbox is sandbox.ts. Eve maps
// each by path, so adding one needs no registration call.
//
// The model id is "claude-haiku-4.5" with a dot; Flue spells the same model
// "claude-haiku-4-5" with dashes. The string is resolved by the gateway at the
// model call, not checked at compile time, so pasting the wrong form across
// projects surfaces only at runtime when the provider rejects the id.
export default defineAgent({
  model: "anthropic/claude-haiku-4.5",
});


// ============================================================================
// ===  FILE 2/5  —  agent/instructions.md   (Markdown system prompt)
// ============================================================================
/*
You are HaikuBot. Your only job is to write a single fresh, original haiku.

Rules:

- Exactly 3 lines.
- Aim for a 5-7-5 syllable feel.
- Never reuse wording from a previous haiku.
- If the caller provides a theme, honour it. Otherwise use "the present moment".
- If the caller provides a random seed, let it nudge your word choices so
  repeated calls don't converge on the same poem.

When the haiku is finished, return it by calling the `compose_haiku` tool
exactly once with the completed poem. Do not write the haiku as plain prose in
your reply — the structured tool output is the deliverable.
*/


// ============================================================================
// ===  FILE 3/5  —  agent/tools/compose_haiku.ts   (structured output)
// ============================================================================

import { defineTool } from "eve/tools";
import { z } from "zod";

// Flue captures structured output with a `result:` schema on one prompt() call.
// Eve has no such call: the agent runs a message loop, so there is no single
// prompt to attach a schema to. The contract HaikuBot expressed with valibot on
// session.prompt() moves here, to a tool's outputSchema.
//
// instructions.md tells the model to call this once. The outputSchema validates
// the arguments, and the validated object is what a channel hands back.
export default defineTool({
  description:
    "Record the finished haiku. Call this exactly once with the completed poem.",
  inputSchema: z.object({
    theme: z.string(),
    haiku: z.array(z.string()).length(3),
    note: z.string(),
  }),
  outputSchema: z.object({
    theme: z.string(),
    haiku: z.array(z.string()),
    note: z.string(),
  }),
  async execute({ theme, haiku, note }) {
    return { theme, haiku, note };
  },
});


// ============================================================================
// ===  FILE 4/5  —  agent/sandbox.ts   (local sandbox backend)
// ============================================================================

import { defineSandbox } from "eve/sandbox";
import { justbash } from "eve/sandbox/just-bash";

// Local sandbox for HaikuBot.
//
// Eve's default backend is whichever of Vercel Sandbox, Docker, microsandbox,
// or just-bash it resolves first. Pinning justbash() runs the sandbox in this
// Node process, so it needs no Docker daemon and no network call.
//
// The subpath is `eve/sandbox/just-bash` (hyphenated) and exports `justbash`.
// `eve/sandbox/justbash` throws ERR_PACKAGE_PATH_NOT_EXPORTED; checked against
// eve@0.11.8.
export default defineSandbox({
  backend: justbash(),
});


// ============================================================================
// ===  FILE 5/5  —  package.json   (JSON, not TypeScript — shown for context)
// ============================================================================
/*
{
  "name": "haikubot-eve-agent",
  "private": true,
  "type": "module",
  "dependencies": {
    "ai": "^7.0.0-beta.178",
    "eve": "^0.11.8",
    "zod": "^4.4.3"
  }
}
*/
