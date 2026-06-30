import { describe, expect, it } from "vite-plus/test";
import {
  disabled,
  evaluate,
  fromConfig,
  match,
  merge,
  type PermissionRule,
} from "../../agents/permission";

describe("match", () => {
  it("handles ? and * glob tokens", () => {
    expect(match("file1.txt", "file?.txt")).toBe(true);
    expect(match("file12.txt", "file?.txt")).toBe(false);
    expect(match("foo+bar", "foo+bar")).toBe(true);
  });

  it("matches a trailing-space wildcard with or without args", () => {
    expect(match("ls", "ls *")).toBe(true);
    expect(match("ls -la", "ls *")).toBe(true);
    expect(match("lstmeval", "ls *")).toBe(false);
  });

  it("normalizes backslashes for cross-platform globbing", () => {
    expect(match("C:\\Windows\\System32\\drivers", "C:/Windows/System32/*")).toBe(true);
  });
});

describe("evaluate", () => {
  it("returns deny when a matching deny rule exists", () => {
    const rs: PermissionRule[] = [{ permission: "bash", pattern: "*", action: "deny" }];
    expect(evaluate("bash", "/tmp/x", rs).action).toBe("deny");
  });

  it("last matching rule wins", () => {
    const rs: PermissionRule[] = [
      { permission: "read", pattern: "*", action: "deny" },
      { permission: "read", pattern: "*.md", action: "allow" },
    ];
    expect(evaluate("read", "a.md", rs).action).toBe("allow");
    expect(evaluate("read", "a.txt", rs).action).toBe("deny");
  });

  it("defaults to ask when nothing matches", () => {
    expect(evaluate("webfetch", "http://x", []).action).toBe("ask");
  });

  it("accepts multiple rulesets flattened together", () => {
    const base: PermissionRule[] = [{ permission: "read", pattern: "*", action: "allow" }];
    const session: PermissionRule[] = [{ permission: "read", pattern: "*.env", action: "deny" }];
    expect(evaluate("read", "a.env", base, session).action).toBe("deny");
    expect(evaluate("read", "a.ts", base, session).action).toBe("allow");
  });
});

describe("fromConfig", () => {
  it("flattens a nested permission tree into rules", () => {
    const rules = fromConfig({
      "*": "allow",
      bash: "deny",
      read: { "*.env": "ask", "*": "allow" },
    });
    expect(rules).toContainEqual({
      permission: "*",
      pattern: "*",
      action: "allow",
    });
    expect(rules).toContainEqual({
      permission: "bash",
      pattern: "*",
      action: "deny",
    });
    expect(rules).toContainEqual({
      permission: "read",
      pattern: "*.env",
      action: "ask",
    });
    expect(rules).toContainEqual({
      permission: "read",
      pattern: "*",
      action: "allow",
    });
  });

  it("expands ~ and $HOME in patterns", () => {
    const home = process.env.HOME ?? process.cwd();
    const rules = fromConfig({ read: { "~/.ssh/*": "deny" } });
    expect(rules[0]?.pattern).toBe(`${home}/.ssh/*`);
  });
});

describe("merge", () => {
  it("concatenates rulesets (later wins via evaluate)", () => {
    const a: PermissionRule[] = [{ permission: "read", pattern: "*", action: "allow" }];
    const b: PermissionRule[] = [{ permission: "read", pattern: "*.env", action: "deny" }];
    expect(merge(a, b)).toEqual([...a, ...b]);
  });
});

describe("disabled", () => {
  it("lists tools whose whole-permission rule is denied", () => {
    const rs = fromConfig({ "*": "deny", read: "allow" });
    expect(disabled(["read", "bash", "write"], rs)).toEqual(new Set(["bash", "write"]));
  });
});
