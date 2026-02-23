/**
 * Part Guards Tests
 *
 * Tests for part type validation functions.
 */

import {
  getRequiredFields,
  hasRequiredFields,
  isValidPart,
  isValidPermissionPart,
  isValidQuestionPart,
  isValidReasoningPart,
  isValidTextPart,
  isValidToolPart,
  validatePart,
  validatePermissionPart,
  validateQuestionPart,
  validateReasoningPart,
  validateTextPart,
  validateToolPart,
} from "@/core/chat/domain/part-guards";
import type { Part } from "@sakti-code/shared/event-types";
import { describe, expect, it } from "vitest";

describe("Part Guards", () => {
  describe("Text Part Validation", () => {
    const validTextPart: Part = {
      type: "text",
      id: "part-1",
      messageID: "msg-1",
      text: "Hello world",
    };

    it("validates correct text part", () => {
      expect(isValidTextPart(validTextPart)).toBe(true);
      const result = validateTextPart(validTextPart);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("rejects text part with wrong type", () => {
      const invalid = { ...validTextPart, type: "tool" };
      expect(isValidTextPart(invalid)).toBe(false);
      const result = validateTextPart(invalid);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Expected type "text"');
    });

    it("rejects text part with missing id", () => {
      const invalid = { ...validTextPart, id: undefined };
      expect(isValidTextPart(invalid)).toBe(false);
      const result = validateTextPart(invalid);
      expect(result.errors).toContain('Missing or invalid required field: "id"');
    });

    it("rejects text part with empty id", () => {
      const invalid = { ...validTextPart, id: "" };
      expect(isValidTextPart(invalid)).toBe(false);
    });

    it("rejects text part with missing messageID", () => {
      const invalid = { ...validTextPart, messageID: undefined };
      expect(isValidTextPart(invalid)).toBe(false);
      const result = validateTextPart(invalid);
      expect(result.errors).toContain('Missing or invalid required field: "messageID"');
    });

    it("allows empty text string", () => {
      const emptyText = { ...validTextPart, text: "" };
      expect(isValidTextPart(emptyText)).toBe(true);
    });

    it("rejects text part with non-string text", () => {
      const invalid = { ...validTextPart, text: 123 };
      expect(isValidTextPart(invalid)).toBe(false);
    });
  });

  describe("Reasoning Part Validation", () => {
    const validReasoningPart: Part = {
      type: "reasoning",
      id: "part-1",
      messageID: "msg-1",
      text: "Thinking...",
    };

    it("validates correct reasoning part", () => {
      expect(isValidReasoningPart(validReasoningPart)).toBe(true);
      const result = validateReasoningPart(validReasoningPart);
      expect(result.valid).toBe(true);
    });

    it("rejects reasoning part with wrong type", () => {
      const invalid = { ...validReasoningPart, type: "text" };
      expect(isValidReasoningPart(invalid)).toBe(false);
    });

    it("rejects reasoning part with missing id", () => {
      const invalid = { ...validReasoningPart, id: undefined };
      expect(isValidReasoningPart(invalid)).toBe(false);
    });
  });

  describe("Tool Part Validation", () => {
    const validToolPart: Part = {
      type: "tool",
      id: "part-1",
      messageID: "msg-1",
      tool: "read_file",
      callID: "call-1",
      state: {
        status: "running",
        input: { path: "/tmp/file.txt" },
      },
    };

    it("validates correct tool part", () => {
      expect(isValidToolPart(validToolPart)).toBe(true);
      const result = validateToolPart(validToolPart);
      expect(result.valid).toBe(true);
    });

    it("rejects tool part with wrong type", () => {
      const invalid = { ...validToolPart, type: "text" };
      expect(isValidToolPart(invalid)).toBe(false);
    });

    it("accepts tool-call part type", () => {
      const toolCallPart = { ...validToolPart, type: "tool-call" };
      expect(isValidToolPart(toolCallPart)).toBe(true);
      const result = validateToolPart(toolCallPart);
      expect(result.valid).toBe(true);
    });

    it("rejects tool part with missing tool name", () => {
      const invalid = { ...validToolPart, tool: undefined };
      expect(isValidToolPart(invalid)).toBe(false);
      const result = validateToolPart(invalid);
      expect(result.errors).toContain('Missing or invalid required field: "tool"');
    });

    it("rejects tool part with missing callID", () => {
      const invalid = { ...validToolPart, callID: undefined };
      expect(isValidToolPart(invalid)).toBe(false);
    });

    it("rejects tool part with missing state", () => {
      const invalid = { ...validToolPart, state: undefined };
      expect(isValidToolPart(invalid)).toBe(false);
    });

    it("rejects tool part with invalid state.status", () => {
      const invalid = {
        ...validToolPart,
        state: { status: "invalid-status" },
      };
      expect(isValidToolPart(invalid)).toBe(false);
      const result = validateToolPart(invalid);
      expect(result.errors[0]).toContain("Invalid state.status");
    });

    it("accepts all valid state statuses", () => {
      const statuses = ["pending", "running", "completed", "failed"] as const;
      statuses.forEach(status => {
        const part = { ...validToolPart, state: { status } };
        expect(isValidToolPart(part)).toBe(true);
      });
    });
  });

  describe("Permission Part Validation", () => {
    const validPermissionPart: Part = {
      type: "permission",
      id: "part-1",
      messageID: "msg-1",
      permissionId: "perm-1",
      toolName: "bash",
      args: { command: "ls -la" },
    };

    it("validates correct permission part", () => {
      expect(isValidPermissionPart(validPermissionPart)).toBe(true);
      const result = validatePermissionPart(validPermissionPart);
      expect(result.valid).toBe(true);
    });

    it("rejects permission part with wrong type", () => {
      const invalid = { ...validPermissionPart, type: "text" };
      expect(isValidPermissionPart(invalid)).toBe(false);
    });

    it("rejects permission part with missing permissionId", () => {
      const invalid = { ...validPermissionPart, permissionId: undefined };
      expect(isValidPermissionPart(invalid)).toBe(false);
    });

    it("rejects permission part with missing toolName", () => {
      const invalid = { ...validPermissionPart, toolName: undefined };
      expect(isValidPermissionPart(invalid)).toBe(false);
    });

    it("rejects permission part with missing args", () => {
      const invalid = { ...validPermissionPart, args: undefined };
      expect(isValidPermissionPart(invalid)).toBe(false);
    });

    it("rejects permission part with non-object args", () => {
      const invalid = { ...validPermissionPart, args: "string-args" };
      expect(isValidPermissionPart(invalid)).toBe(false);
    });
  });

  describe("Question Part Validation", () => {
    const validQuestionPart: Part = {
      type: "question",
      id: "part-1",
      messageID: "msg-1",
      questionId: "q-1",
      question: "What is your name?",
    };

    it("validates correct question part", () => {
      expect(isValidQuestionPart(validQuestionPart)).toBe(true);
      const result = validateQuestionPart(validQuestionPart);
      expect(result.valid).toBe(true);
    });

    it("rejects question part with wrong type", () => {
      const invalid = { ...validQuestionPart, type: "text" };
      expect(isValidQuestionPart(invalid)).toBe(false);
    });

    it("rejects question part with missing questionId", () => {
      const invalid = { ...validQuestionPart, questionId: undefined };
      expect(isValidQuestionPart(invalid)).toBe(false);
    });

    it("rejects question part with missing question", () => {
      const invalid = { ...validQuestionPart, question: undefined };
      expect(isValidQuestionPart(invalid)).toBe(false);
    });

    it("rejects question part with empty question", () => {
      const invalid = { ...validQuestionPart, question: "" };
      expect(isValidQuestionPart(invalid)).toBe(false);
    });
  });

  describe("Generic Part Validation", () => {
    it("validates text part using generic validatePart", () => {
      const part: Part = {
        type: "text",
        id: "part-1",
        messageID: "msg-1",
        text: "Hello",
      };
      const result = validatePart(part);
      expect(result.valid).toBe(true);
    });

    it("validates tool part using generic validatePart", () => {
      const part: Part = {
        type: "tool",
        id: "part-1",
        messageID: "msg-1",
        tool: "read",
        callID: "call-1",
        state: { status: "completed" },
      };
      const result = validatePart(part);
      expect(result.valid).toBe(true);
    });

    it("returns error for unknown part type", () => {
      const part: Part = {
        type: "unknown-type",
        id: "part-1",
      };
      const result = validatePart(part);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("Unknown part type");
    });

    it("isValidPart returns true for valid parts", () => {
      const validParts: Part[] = [
        { type: "text", id: "1", messageID: "m1", text: "Hello" },
        { type: "reasoning", id: "2", messageID: "m1", text: "Thinking" },
        {
          type: "tool",
          id: "3",
          messageID: "m1",
          tool: "read",
          callID: "c1",
          state: { status: "running" },
        },
        {
          type: "permission",
          id: "4",
          messageID: "m1",
          permissionId: "p1",
          toolName: "bash",
          args: {},
        },
        { type: "question", id: "5", messageID: "m1", questionId: "q1", question: "What?" },
      ];

      validParts.forEach(part => {
        expect(isValidPart(part)).toBe(true);
      });
    });

    it("isValidPart returns false for invalid parts", () => {
      const invalidParts: Part[] = [
        { type: "text", id: "", messageID: "m1", text: "" }, // Empty id
        {
          type: "tool",
          id: "1",
          messageID: "m1",
          tool: "",
          callID: "c1",
          state: { status: "running" },
        }, // Empty tool
        { type: "unknown", id: "1" }, // Unknown type
      ];

      invalidParts.forEach(part => {
        expect(isValidPart(part)).toBe(false);
      });
    });
  });

  describe("Required Fields", () => {
    it("getRequiredFields returns correct fields for text", () => {
      const fields = getRequiredFields("text");
      expect(fields).toContain("id");
      expect(fields).toContain("type");
      expect(fields).toContain("messageID");
      expect(fields).toContain("text");
    });

    it("getRequiredFields returns correct fields for tool", () => {
      const fields = getRequiredFields("tool");
      expect(fields).toContain("id");
      expect(fields).toContain("tool");
      expect(fields).toContain("callID");
      expect(fields).toContain("state");
    });

    it("hasRequiredFields returns true when all fields present", () => {
      const part: Part = {
        type: "text",
        id: "part-1",
        messageID: "msg-1",
        text: "Hello",
      };
      expect(hasRequiredFields(part, "text")).toBe(true);
    });

    it("hasRequiredFields returns false when fields missing", () => {
      const part: Part = {
        type: "text",
        id: "part-1",
        // Missing messageID and text
      };
      expect(hasRequiredFields(part, "text")).toBe(false);
    });
  });
});
