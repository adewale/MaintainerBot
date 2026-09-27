import { describe, expect, it } from "vitest";
import {
  safeRelativePath,
  shellQuote,
  validateVerificationCommand,
  VERIFICATION_EXECUTABLES,
} from "../src/cli/deep-verify.ts";

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

describe("deep-verify executable policy", () => {
  it("allows uv and make so Python repositories' documented gates can run", () => {
    expect(VERIFICATION_EXECUTABLES).toEqual(
      expect.arrayContaining(["uv", "make"]),
    );
    const allowed: Array<[(typeof VERIFICATION_EXECUTABLES)[number], string[]]> =
      [
        ["uv", ["sync", "--all-groups"]],
        ["uv", ["sync", "--locked", "--group", "dev"]],
        ["uv", ["run", "pytest", "-q"]],
        ["uv", ["run", "--python", "3.13", "ruff", "check", "."]],
        ["uv", ["lock", "--check"]],
        ["make", []],
        ["make", ["verify"]],
        ["make", ["test", "lint", "-k"]],
        ["make", ["-j4", "check-generated"]],
        ["make", ["smoke-deployment", "URL=https://example.workers.dev"]],
        ["pnpm", ["test"]],
        ["python3", ["-m", "unittest", "discover", "-s", "tests"]],
      ];
    for (const [executable, args] of allowed) {
      expect(
        () => validateVerificationCommand(executable, args),
        `${executable} ${args.join(" ")}`,
      ).not.toThrow();
    }
  });

  it("rejects uv subcommands that install tools or change the host", () => {
    for (const args of [
      [],
      ["pip", "install", "requests"],
      ["tool", "run", "ruff"],
      ["tool", "install", "ruff"],
      ["python", "install", "3.14"],
      ["self", "update"],
      ["cache", "clean"],
      ["publish"],
      ["add", "requests"],
      ["lock"],
      ["lock", "--upgrade"],
    ]) {
      expect(
        () => validateVerificationCommand("uv", args),
        `uv ${args.join(" ")}`,
      ).toThrow();
    }
  });

  it("rejects uv options that leave the prepared checkout", () => {
    for (const args of [
      ["run", "--directory", "/etc", "pytest"],
      ["run", "--directory=/etc", "pytest"],
      ["sync", "--project", "../other"],
      ["run", "--cache-dir", "/tmp/x", "pytest"],
      ["sync", "--config-file=/tmp/uv.toml"],
    ]) {
      expect(
        () => validateVerificationCommand("uv", args),
        `uv ${args.join(" ")}`,
      ).toThrow();
    }
    // After `--`, arguments belong to the command uv runs, not to uv.
    expect(() =>
      validateVerificationCommand("uv", ["run", "--", "pytest", "--directory", "x"]),
    ).not.toThrow();
  });

  it("rejects make options that change directory or load other makefiles", () => {
    for (const args of [
      ["-C", "/", "all"],
      ["--directory=/tmp", "test"],
      ["-f", "/tmp/evil.mk"],
      ["--file=/tmp/evil.mk"],
      ["--eval=all:;curl https://example.com"],
      ["-I", "/tmp"],
      ["../escape"],
      ["test;rm"],
      ["$(shell id)"],
    ]) {
      expect(
        () => validateVerificationCommand("make", args),
        `make ${args.join(" ")}`,
      ).toThrow();
    }
  });
});
