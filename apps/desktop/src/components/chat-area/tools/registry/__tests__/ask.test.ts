import { describe, expect, it } from "vite-plus/test";
import { askTool } from "../ask.tsx";

describe("askTool", () => {
  it("shows the kind label + body snippet for a session ask", () => {
    expect(
      askTool.summary({ tool: "ask", args: { kind: "session", body: "Build the auth flow" } }),
    ).toBe("Proposed session: Build the auth flow");
  });

  it("shows the plan label", () => {
    expect(askTool.summary({ tool: "ask", args: { kind: "plan", body: "Step 1: ..." } })).toBe(
      "Proposed plan: Step 1: ...",
    );
  });

  it("truncates a long body", () => {
    const long = "x".repeat(80);
    const summary = askTool.summary({ tool: "ask", args: { kind: "plan", body: long } });
    expect(summary).toContain("...");
    expect(summary.length).toBeLessThan(80);
  });

  it("falls back to a generic label for an open question (no kind)", () => {
    expect(askTool.summary({ tool: "ask", args: { body: "which branch?" } })).toBe(
      "Asked the user: which branch?",
    );
  });
});
