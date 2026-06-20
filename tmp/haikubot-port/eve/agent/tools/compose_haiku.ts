import { defineTool } from "eve/tools";
import { z } from "zod";

// Eve has no `result:` argument on a prompt() call the way Flue does, because
// there is no single prompt() call to attach it to — the agent runs an
// instructions-driven loop. So the structured contract that HaikuBot used to
// express via valibot on session.prompt() becomes a tool's outputSchema here.
//
// The model is told (in instructions.md) to call this exactly once; the
// outputSchema is what gives channels a typed, validated haiku to deliver.
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
