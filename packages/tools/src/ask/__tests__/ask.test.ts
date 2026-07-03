import { describe, expect, it } from "vite-plus/test";
import { createAskTool } from "../index.ts";

describe("createAskTool", () => {
  const tool = createAskTool();

  it("has the correct name and label", () => {
    expect(tool.name).toBe("ask");
    expect(tool.label).toBe("ask");
  });

  it("has a body parameter and optional kind", () => {
    expect(tool.parameters.properties).toHaveProperty("body");
    expect(tool.parameters.properties).toHaveProperty("kind");
  });

  it("terminates the turn and returns awaiting text (with kind)", async () => {
    const result = await tool.execute("call-1", {
      kind: "session",
      body: "A brief for the mission",
    });
    expect(result.terminate).toBe(true);
    expect(result.details).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe("text");
  });

  it("accepts a call without a kind (open question)", async () => {
    const result = await tool.execute("call-2", { body: "which branch?" });
    expect(result.terminate).toBe(true);
    expect(result.content).toHaveLength(1);
  });
});
