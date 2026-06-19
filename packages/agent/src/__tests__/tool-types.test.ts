import { describe, expect, it } from "vitest";
import type { AgentTool, AgentToolResult } from "../types";

describe("AgentTool interface", () => {
  it("has name, description, parameters schema", () => {
    const tool: AgentTool = {
      name: "read",
      description: "Read a file",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
      execute: async () => ({ content: "hello", terminate: false }),
    };
    expect(tool.name).toBe("read");
    expect(tool.description).toBe("Read a file");
    expect(tool.parameters.type).toBe("object");
  });

  it("execute returns AgentToolResult", async () => {
    const tool: AgentTool = {
      name: "bash",
      description: "Run a command",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ content: "output", terminate: false }),
    };
    const result = await tool.execute("tc_1", { command: "echo hi" });
    expect(result.content).toBe("output");
    expect(result.terminate).toBe(false);
  });

  it("execute supports onUpdate callback", async () => {
    const updates: string[] = [];
    const tool: AgentTool = {
      name: "bash",
      description: "Run a command",
      parameters: { type: "object", properties: {} },
      execute: async (_id, _args, _signal, onUpdate) => {
        onUpdate?.("partial...");
        return { content: "done", terminate: false };
      },
    };
    await tool.execute("tc_1", {}, undefined, (u) => updates.push(u));
    expect(updates).toEqual(["partial..."]);
  });

  it("execute supports terminate result", async () => {
    const tool: AgentTool = {
      name: "kill",
      description: "Stop",
      parameters: { type: "object", properties: {} },
      execute: async () => ({ content: "stopped", terminate: true }),
    };
    const result = await tool.execute("tc_1", {});
    expect(result.terminate).toBe(true);
  });
});

describe("AgentToolResult type", () => {
  it("has content string and terminate flag", () => {
    const result: AgentToolResult = { content: "file contents", terminate: false };
    expect(result.content).toBe("file contents");
    expect(result.terminate).toBe(false);
  });

  it("isAgentTool runtime guard validates structure", async () => {
    const { isAgentTool } = await import("../types");
    const tool: AgentTool = {
      name: "read",
      description: "Read",
      parameters: {},
      execute: async () => ({ content: "ok", terminate: false }),
    };
    expect(isAgentTool(tool)).toBe(true);
    expect(isAgentTool(null)).toBe(false);
    expect(isAgentTool({ name: "x" })).toBe(false);
  });
});
