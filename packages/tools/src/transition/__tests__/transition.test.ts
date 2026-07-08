import { describe, expect, it } from "vite-plus/test";
import { createTransitionTool } from "../index.ts";

describe("createTransitionTool", () => {
  const tool = createTransitionTool();

  it("has the correct name and label", () => {
    expect(tool.name).toBe("transition");
    expect(tool.label).toBe("transition");
  });

  it("takes a `to` destination and a `body`", () => {
    expect(tool.parameters.properties).toHaveProperty("to");
    expect(tool.parameters.properties).toHaveProperty("body");
  });

  it("terminates the turn and returns a neutral acknowledgement", async () => {
    const result = await tool.execute("call-1", {
      to: "verify",
      body: "All tasks complete; tests pass.",
    });
    expect(result.terminate).toBe(true);
    expect(result.details).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe("text");
  });

  it("is a pure signal — no side-effects, no instruction in the result", async () => {
    const result = await tool.execute("call-2", {
      to: "build",
      body: "fixing plan",
    });
    const text = result.content[0];
    expect(text?.type).toBe("text");
    // The <instruction> for the next phase is delivered server-side (tool
    // result augmented / handoff message), not from this tool.
    expect((text as { text: string }).text).not.toContain("<instruction>");
  });

  it("accepts every known destination phase", async () => {
    for (const to of ["specify", "build", "verify", "archive", "mission"]) {
      const result = await tool.execute(`call-${to}`, { to, body: "brief" });
      expect(result.terminate).toBe(true);
    }
  });
});
