/**
 * Part Type Guards
 *
 * Validation functions for part types based on Phase 0 contracts.
 * Ensures parts have required fields before rendering.
 */

import type { Part } from "@sakti-code/shared/event-types";

/** Valid part types for rendering */
export type ValidPartType = "text" | "reasoning" | "tool" | "tool-call" | "permission" | "question";

/** Text part structure */
export interface TextPart extends Part {
  type: "text";
  id: string;
  messageID: string;
  text: string;
}

/** Reasoning part structure */
export interface ReasoningPart extends Part {
  type: "reasoning";
  id: string;
  messageID: string;
  text: string;
}

/** Tool part state */
export interface ToolState {
  status: "pending" | "running" | "completed" | "failed";
  input?: Record<string, unknown>;
  output?: string;
  error?: string;
}

/** Tool part structure */
export interface ToolPart extends Part {
  type: "tool" | "tool-call";
  id: string;
  messageID: string;
  tool: string;
  callID: string;
  state: ToolState;
}

/** Permission part structure */
export interface PermissionPart extends Part {
  type: "permission";
  id: string;
  messageID: string;
  permissionId: string;
  toolName: string;
  args: Record<string, unknown>;
  description?: string;
  status?: "pending" | "approved" | "denied";
}

/** Question part structure */
export interface QuestionPart extends Part {
  type: "question";
  id: string;
  messageID: string;
  questionId: string;
  question: string;
  options?: string[];
  status?: "pending" | "answered";
}

/** Validation result */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate that a value is a non-empty string
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Validate that a value is a string (can be empty)
 */
function isString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * Validate that a value is a plain object
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate text part
 * Required fields: id, type, messageID, text
 */
export function isValidTextPart(part: Part): part is TextPart {
  if (part.type !== "text") return false;
  if (!isNonEmptyString((part as { id?: string }).id)) return false;
  if (!isNonEmptyString((part as { messageID?: string }).messageID)) return false;
  if (!isString((part as { text?: string }).text)) return false;
  return true;
}

/**
 * Validate text part with detailed errors
 */
export function validateTextPart(part: Part): ValidationResult {
  const errors: string[] = [];

  if (part.type !== "text") {
    errors.push(`Expected type "text", got "${part.type}"`);
  }

  const id = (part as { id?: string }).id;
  if (!isNonEmptyString(id)) {
    errors.push('Missing or invalid required field: "id"');
  }

  const messageID = (part as { messageID?: string }).messageID;
  if (!isNonEmptyString(messageID)) {
    errors.push('Missing or invalid required field: "messageID"');
  }

  const text = (part as { text?: string }).text;
  if (!isString(text)) {
    errors.push('Missing or invalid required field: "text"');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate reasoning part
 * Required fields: id, type, messageID, text
 */
export function isValidReasoningPart(part: Part): part is ReasoningPart {
  if (part.type !== "reasoning") return false;
  if (!isNonEmptyString((part as { id?: string }).id)) return false;
  if (!isNonEmptyString((part as { messageID?: string }).messageID)) return false;
  if (!isString((part as { text?: string }).text)) return false;
  return true;
}

/**
 * Validate reasoning part with detailed errors
 */
export function validateReasoningPart(part: Part): ValidationResult {
  const errors: string[] = [];

  if (part.type !== "reasoning") {
    errors.push(`Expected type "reasoning", got "${part.type}"`);
  }

  const id = (part as { id?: string }).id;
  if (!isNonEmptyString(id)) {
    errors.push('Missing or invalid required field: "id"');
  }

  const messageID = (part as { messageID?: string }).messageID;
  if (!isNonEmptyString(messageID)) {
    errors.push('Missing or invalid required field: "messageID"');
  }

  const text = (part as { text?: string }).text;
  if (!isString(text)) {
    errors.push('Missing or invalid required field: "text"');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate tool part
 * Required fields: id, type, messageID, tool, callID, state
 */
export function isValidToolPart(part: Part): part is ToolPart {
  if (part.type !== "tool" && part.type !== "tool-call") return false;
  if (!isNonEmptyString((part as { id?: string }).id)) return false;
  if (!isNonEmptyString((part as { messageID?: string }).messageID)) return false;
  if (!isNonEmptyString((part as { tool?: string }).tool)) return false;
  if (!isNonEmptyString((part as { callID?: string }).callID)) return false;

  const state = (part as { state?: unknown }).state;
  if (!isObject(state)) return false;

  const status = (state as { status?: string }).status;
  if (!["pending", "running", "completed", "failed"].includes(status || "")) {
    return false;
  }

  return true;
}

/**
 * Validate tool part with detailed errors
 */
export function validateToolPart(part: Part): ValidationResult {
  const errors: string[] = [];

  if (part.type !== "tool" && part.type !== "tool-call") {
    errors.push(`Expected type "tool" | "tool-call", got "${part.type}"`);
  }

  const id = (part as { id?: string }).id;
  if (!isNonEmptyString(id)) {
    errors.push('Missing or invalid required field: "id"');
  }

  const messageID = (part as { messageID?: string }).messageID;
  if (!isNonEmptyString(messageID)) {
    errors.push('Missing or invalid required field: "messageID"');
  }

  const tool = (part as { tool?: string }).tool;
  if (!isNonEmptyString(tool)) {
    errors.push('Missing or invalid required field: "tool"');
  }

  const callID = (part as { callID?: string }).callID;
  if (!isNonEmptyString(callID)) {
    errors.push('Missing or invalid required field: "callID"');
  }

  const state = (part as { state?: unknown }).state;
  if (!isObject(state)) {
    errors.push('Missing or invalid required field: "state"');
  } else {
    const status = (state as { status?: string }).status;
    const validStatuses = ["pending", "running", "completed", "failed"];
    if (!validStatuses.includes(status || "")) {
      errors.push(
        `Invalid state.status: "${status}". Expected one of: ${validStatuses.join(", ")}`
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate permission part
 * Required fields: id, type, messageID, permissionId, toolName, args
 */
export function isValidPermissionPart(part: Part): part is PermissionPart {
  if (part.type !== "permission") return false;
  if (!isNonEmptyString((part as { id?: string }).id)) return false;
  if (!isNonEmptyString((part as { messageID?: string }).messageID)) return false;
  if (!isNonEmptyString((part as { permissionId?: string }).permissionId)) return false;
  if (!isNonEmptyString((part as { toolName?: string }).toolName)) return false;
  if (!isObject((part as { args?: unknown }).args)) return false;
  return true;
}

/**
 * Validate permission part with detailed errors
 */
export function validatePermissionPart(part: Part): ValidationResult {
  const errors: string[] = [];

  if (part.type !== "permission") {
    errors.push(`Expected type "permission", got "${part.type}"`);
  }

  const id = (part as { id?: string }).id;
  if (!isNonEmptyString(id)) {
    errors.push('Missing or invalid required field: "id"');
  }

  const messageID = (part as { messageID?: string }).messageID;
  if (!isNonEmptyString(messageID)) {
    errors.push('Missing or invalid required field: "messageID"');
  }

  const permissionId = (part as { permissionId?: string }).permissionId;
  if (!isNonEmptyString(permissionId)) {
    errors.push('Missing or invalid required field: "permissionId"');
  }

  const toolName = (part as { toolName?: string }).toolName;
  if (!isNonEmptyString(toolName)) {
    errors.push('Missing or invalid required field: "toolName"');
  }

  const args = (part as { args?: unknown }).args;
  if (!isObject(args)) {
    errors.push('Missing or invalid required field: "args"');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate question part
 * Required fields: id, type, messageID, questionId, question
 */
export function isValidQuestionPart(part: Part): part is QuestionPart {
  if (part.type !== "question") return false;
  if (!isNonEmptyString((part as { id?: string }).id)) return false;
  if (!isNonEmptyString((part as { messageID?: string }).messageID)) return false;
  if (!isNonEmptyString((part as { questionId?: string }).questionId)) return false;
  if (!isNonEmptyString((part as { question?: string }).question)) return false;
  return true;
}

/**
 * Validate question part with detailed errors
 */
export function validateQuestionPart(part: Part): ValidationResult {
  const errors: string[] = [];

  if (part.type !== "question") {
    errors.push(`Expected type "question", got "${part.type}"`);
  }

  const id = (part as { id?: string }).id;
  if (!isNonEmptyString(id)) {
    errors.push('Missing or invalid required field: "id"');
  }

  const messageID = (part as { messageID?: string }).messageID;
  if (!isNonEmptyString(messageID)) {
    errors.push('Missing or invalid required field: "messageID"');
  }

  const questionId = (part as { questionId?: string }).questionId;
  if (!isNonEmptyString(questionId)) {
    errors.push('Missing or invalid required field: "questionId"');
  }

  const question = (part as { question?: string }).question;
  if (!isNonEmptyString(question)) {
    errors.push('Missing or invalid required field: "question"');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Generic part validation - validates based on part type
 */
export function validatePart(part: Part): ValidationResult {
  const type = (part as { type?: string }).type;

  switch (type) {
    case "text":
      return validateTextPart(part);
    case "reasoning":
      return validateReasoningPart(part);
    case "tool":
    case "tool-call":
      return validateToolPart(part);
    case "permission":
      return validatePermissionPart(part);
    case "question":
      return validateQuestionPart(part);
    default:
      return {
        valid: false,
        errors: [`Unknown part type: "${type}"`],
      };
  }
}

/**
 * Check if part is valid (type guard)
 */
export function isValidPart(part: Part): boolean {
  const type = (part as { type?: string }).type;

  switch (type) {
    case "text":
      return isValidTextPart(part);
    case "reasoning":
      return isValidReasoningPart(part);
    case "tool":
    case "tool-call":
      return isValidToolPart(part);
    case "permission":
      return isValidPermissionPart(part);
    case "question":
      return isValidQuestionPart(part);
    default:
      return false;
  }
}

/**
 * Get required fields for a part type
 */
export function getRequiredFields(partType: ValidPartType): string[] {
  const requiredFields: Record<ValidPartType, string[]> = {
    text: ["id", "type", "messageID", "text"],
    reasoning: ["id", "type", "messageID", "text"],
    tool: ["id", "type", "messageID", "tool", "callID", "state"],
    "tool-call": ["id", "type", "messageID", "tool", "callID", "state"],
    permission: ["id", "type", "messageID", "permissionId", "toolName", "args"],
    question: ["id", "type", "messageID", "questionId", "question"],
  };

  return requiredFields[partType] || [];
}

/**
 * Check if all required fields are present
 */
export function hasRequiredFields(part: Part, partType: ValidPartType): boolean {
  const required = getRequiredFields(partType);
  return required.every(field => {
    const value = (part as Record<string, unknown>)[field];
    return value !== undefined && value !== null;
  });
}
