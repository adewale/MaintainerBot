import { defineAgent } from "eve";

// In Eve the agent is the *directory*, not this file. agent.ts only carries
// the runtime knobs that don't have their own home — here, just the model.
// The system prompt lives in instructions.md; behaviour lives in tools/ and
// channels/, which Eve discovers by location (no manual registration).
//
// Note the model id uses dots (claude-haiku-4.5) to match Eve's docs, whereas
// Flue's routing strings use dashes (claude-haiku-4-5). Same model, two
// spellings — an easy thing to trip on when porting between the two.
export default defineAgent({
  model: "anthropic/claude-haiku-4.5",
});
