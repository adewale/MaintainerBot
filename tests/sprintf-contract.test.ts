import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { Bash } from "just-bash";

// Resolve the formatter through its actual consumer, not a separate test copy.
const consumerRequire = createRequire(createRequire(import.meta.url).resolve("just-bash"));
const { sprintf } = consumerRequire("sprintf-js") as {
  sprintf: (format: string, ...args: unknown[]) => string;
};

describe("just-bash's patched sprintf dependency", () => {
  it("rejects out-of-range numeric precision before native conversion", () => {
    for (const format of ["%.101f", "%.101e", "%.101g", "%.999999999999999999999f"]) {
      expect(() => sprintf(format, 1), format).toThrow(SyntaxError);
      expect(() => sprintf(format, 1), format).toThrow("precision must be between 0 and 100");
    }
    let evaluated = false;
    expect(() => sprintf("%.101f", () => { evaluated = true; return 1; })).toThrow(SyntaxError);
    expect(evaluated).toBe(false);
  });

  it("preserves zero precision, the numeric upper bound and nonnumeric precision", () => {
    expect(sprintf("%.0g", 1.25)).toBe("1");
    expect(sprintf("%.0f", 1.25)).toBe("1");
    expect(sprintf("%.0e", 1)).toBe("1e+0");
    expect(sprintf("%.100f", 1)).toBe(`1.${"0".repeat(100)}`);
    expect(sprintf("%.101s", "unchanged")).toBe("unchanged");
    expect(sprintf("%(amount).2f", { amount: 1.25 })).toBe("1.25");
  });

  it("keeps a malformed shell printf contained and the interpreter usable", async () => {
    const bash = new Bash();
    const rejected = await bash.exec("printf '%.101f' 1");
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stdout).toBe("");
    expect(rejected.stderr).not.toBe("");
    const accepted = await bash.exec("printf '%.2f' 1.25");
    expect(accepted).toMatchObject({ exitCode: 0, stdout: "1.25", stderr: "" });
  });
});
