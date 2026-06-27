import type { Tool, ToolCall } from "@sakti-code/llm";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { validateToolArguments } from "~/core/validation";

describe("validateToolArguments", () => {
  it("passes valid arguments through unchanged", () => {
    const tool: Tool = {
      name: "test",
      description: "test tool",
      parameters: Type.Object({ name: Type.String(), count: Type.Number() }),
    };
    const toolCall: ToolCall = {
      type: "toolCall",
      id: "call_1",
      name: "test",
      arguments: { name: "hello", count: 42 },
    };
    const result = validateToolArguments(tool, toolCall);
    expect(result).toEqual({ name: "hello", count: 42 });
  });

  it("coerces string numbers to number type", () => {
    const tool: Tool = {
      name: "test",
      description: "test tool",
      parameters: Type.Object({ count: Type.Number() }),
    };
    const toolCall: ToolCall = {
      type: "toolCall",
      id: "call_1",
      name: "test",
      arguments: { count: "42" },
    };
    const result = validateToolArguments(tool, toolCall);
    expect(result).toEqual({ count: 42 });
  });

  it("throws a descriptive error on invalid arguments", () => {
    const tool: Tool = {
      name: "test",
      description: "test tool",
      parameters: Type.Object({ count: Type.Number() }),
    };
    const toolCall: ToolCall = {
      type: "toolCall",
      id: "call_1",
      name: "test",
      arguments: { count: "abc" },
    };
    expect(() => validateToolArguments(tool, toolCall)).toThrow(
      'Validation failed for tool "test"'
    );
  });

  it("handles optional properties", () => {
    const tool: Tool = {
      name: "test",
      description: "test tool",
      parameters: Type.Object({
        name: Type.String(),
        age: Type.Optional(Type.Number()),
      }),
    };
    const toolCall: ToolCall = {
      type: "toolCall",
      id: "call_1",
      name: "test",
      arguments: { name: "hello" },
    };
    const result = validateToolArguments(tool, toolCall);
    expect(result).toEqual({ name: "hello" });
  });

  it("does not mutate the original toolCall.arguments", () => {
    const tool: Tool = {
      name: "test",
      description: "test tool",
      parameters: Type.Object({ count: Type.Number() }),
    };
    const toolCall: ToolCall = {
      type: "toolCall",
      id: "call_1",
      name: "test",
      arguments: { count: "42" },
    };
    const original = toolCall.arguments;
    const originalSnapshot = { ...toolCall.arguments };

    validateToolArguments(tool, toolCall);

    expect(toolCall.arguments).toEqual(originalSnapshot);
    expect(toolCall.arguments).toBe(original);
  });

  it("coerces union (anyOf) string-to-number when no member matches as-is", () => {
    const tool: Tool = {
      name: "test",
      description: "test tool",
      parameters: {
        type: "object",
        properties: {
          value: {
            anyOf: [{ type: "number" }, { type: "boolean" }],
          },
        },
        required: ["value"],
      } as unknown as Tool["parameters"],
    };
    const toolCall: ToolCall = {
      type: "toolCall",
      id: "call_1",
      name: "test",
      arguments: { value: "42" },
    };
    const result = validateToolArguments(tool, toolCall);
    expect(result).toEqual({ value: 42 });
  });

  it("passes union (anyOf) value unchanged when it already matches a member", () => {
    const tool: Tool = {
      name: "test",
      description: "test tool",
      parameters: {
        type: "object",
        properties: {
          value: {
            anyOf: [{ type: "number" }, { type: "string" }],
          },
        },
        required: ["value"],
      } as unknown as Tool["parameters"],
    };
    const toolCall: ToolCall = {
      type: "toolCall",
      id: "call_1",
      name: "test",
      arguments: { value: "hello" },
    };
    const result = validateToolArguments(tool, toolCall);
    expect(result).toEqual({ value: "hello" });
  });
});
