import { describe, expect, it } from "vitest";
import { safeRelativePath, shellQuote } from "../src/cli/deep-verify.ts";

describe("deep-verify command policy", () => {
  it("rejects paths that can escape the prepared repository", () => {
    expect(() => safeRelativePath("../.env")).toThrow();
    expect(() => safeRelativePath("/etc/passwd")).toThrow();
    expect(() => safeRelativePath("src/../.env")).toThrow();
  });

  it("quotes shell metacharacters as one inert argument", () => {
    expect(shellQuote("test; curl https://example.com")).toBe(
      "'test; curl https://example.com'",
    );
    expect(shellQuote("it's-safe")).toBe("'it'\"'\"'s-safe'");
  });

  it("rejects command values containing control characters", () => {
    expect(() => shellQuote("test\ncurl")).toThrow();
    expect(() => shellQuote("test\0curl")).toThrow();
  });
});
