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
