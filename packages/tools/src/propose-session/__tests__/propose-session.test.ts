import { describe, expect, it } from "vite-plus/test";
import { createProposeSessionTool } from "../index";

describe("createProposeSessionTool", () => {
  const tool = createProposeSessionTool();

  it("has the correct name and label", () => {
    expect(tool.name).toBe("propose_session");
    expect(tool.label).toBe("propose_session");
  });

  it("has title and message parameters", () => {
    expect(tool.parameters.properties).toHaveProperty("title");
    expect(tool.parameters.properties).toHaveProperty("message");
  });

  it("returns terminate: true", async () => {
    const result = await tool.execute("call-1", {
      title: "Add dark mode",
      message: "Implement dark mode toggle in settings",
    });
    expect(result.terminate).toBe(true);
    expect(result.details).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe("text");
  });
});
