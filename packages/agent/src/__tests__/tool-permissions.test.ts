import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import type { AgentTool, PermissionRequest } from "../types.ts";

describe("AgentTool.permissions declarator", () => {
  const schema = Type.Object({ path: Type.String() });

  it("declares permission requests derived from validated params", () => {
    const tool: AgentTool<typeof schema> = {
      name: "read",
      label: "read",
      description: "d",
      parameters: schema,
      async execute() {
        return { content: [], details: undefined };
      },
      permissions: (params) => [
        { permission: "read", patterns: [(params as { path: string }).path] },
      ],
    };

    const req = tool.permissions?.({ path: "src/a.ts" });
    const expected: PermissionRequest[] = [
      { permission: "read", patterns: ["src/a.ts"] },
    ];
    expect(req).toEqual(expected);
  });

  it("permissions is optional", () => {
    const tool: AgentTool<typeof schema> = {
      name: "x",
      label: "x",
      description: "d",
      parameters: schema,
      async execute() {
        return { content: [], details: undefined };
      },
    };
    expect(tool.permissions).toBeUndefined();
  });
});
