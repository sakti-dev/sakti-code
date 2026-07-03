import { describe, expect, it } from "vite-plus/test";
import { proposeSessionTool } from "../propose-session.tsx";

describe("proposeSessionTool", () => {
  it("shows the title", () => {
    expect(
      proposeSessionTool.summary({ tool: "propose_session", args: { title: "Add auth" } }),
    ).toBe("Proposed session: Add auth");
  });
  it("defaults to untitled", () => {
    expect(proposeSessionTool.summary({ tool: "propose_session", args: {} })).toBe(
      "Proposed session: untitled",
    );
  });
});
