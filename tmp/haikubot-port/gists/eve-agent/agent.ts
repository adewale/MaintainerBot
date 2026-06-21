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
