import { describe, expect, it } from "vite-plus/test";
import { bashTool } from "../bash.tsx";

describe("bashTool", () => {
  it("prefers description", () => {
    expect(
      bashTool.summary({ tool: "bash", args: { command: "ls", description: "list files" } }),
    ).toBe("Executed: list files");
  });
  it("truncates long commands", () => {
    const long = "x".repeat(100);
    expect(bashTool.summary({ tool: "bash", args: { command: long } })).toBe(
      `Executed: ${"x".repeat(57)}...`,
    );
  });
  it("uses unknown command fallback", () => {
    expect(bashTool.summary({ tool: "bash", args: {} })).toBe("Executed: unknown command");
  });
});
