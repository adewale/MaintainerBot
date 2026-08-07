import { describe, expect, it } from "vitest";
import { selectedModel } from "../src/maintenance/daily.ts";

describe("selectedModel()", () => {
  it("uses the configured model when its provider credential exists", () => {
    expect(
      selectedModel({
        FLUE_MODEL: "openai/gpt-5",
        OPENAI_API_KEY: "configured",
      }),
    ).toBe("openai/gpt-5");
  });

  it("falls back to the provider that is actually configured", () => {
    expect(
      selectedModel({
        FLUE_MODEL: "anthropic/claude-haiku-4-5",
        OPENAI_API_KEY: "configured",
      }),
    ).toBe("openai/gpt-4.1-mini");
    expect(
      selectedModel({
        FLUE_MODEL: "anthropic/claude-haiku-4-5",
        OPENROUTER_API_KEY: "configured",
      }),
    ).toBe("openrouter/anthropic/claude-3.5-haiku");
  });

  it("disables model work when no provider credential exists", () => {
    expect(selectedModel({ FLUE_MODEL: "anthropic/claude-haiku-4-5" })).toBe(
      "none",
    );
  });
});
