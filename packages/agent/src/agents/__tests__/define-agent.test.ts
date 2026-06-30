import { describe, expect, it } from "vite-plus/test";
import { defineAgent } from "../define-agent.ts";
import { fromConfig } from "../permission.ts";

describe("defineAgent", () => {
  it("returns the agent definition as-is when valid", () => {
    const ruleset = fromConfig({ "*": "allow" });
    const agent = defineAgent({
      name: "test",
      mode: "primary",
      description: "test",
      systemPrompt: "p",
      permission: ruleset,
    });
    expect(agent.name).toBe("test");
    expect(agent.permission).toBe(ruleset);
  });

  it("applies defaults for optional fields", () => {
    const agent = defineAgent({
      name: "test",
      mode: "primary",
      description: "test",
      systemPrompt: "p",
    });
    expect(agent.activeToolNames).toBeUndefined();
    expect(agent.permission).toBeUndefined();
  });

  it("throws on missing name", () => {
    expect(() =>
      defineAgent({
        name: "",
        mode: "primary",
        description: "x",
        systemPrompt: "x",
      }),
    ).toThrow(/name/);
  });

  it("throws on missing systemPrompt", () => {
    expect(() =>
      defineAgent({
        name: "x",
        mode: "primary",
        description: "x",
        systemPrompt: "",
      }),
    ).toThrow(/systemPrompt/);
  });
});
