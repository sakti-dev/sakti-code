/**
 * Part Fixtures for Testing
 *
 * Provides test data for part component testing.
 */

import type { Part } from "@sakti-code/shared/event-types";

/**
 * Create a text part for testing
 */
export function createTextPart(overrides?: Partial<Part>): Part {
  return {
    id: "text-part-1",
    type: "text",
    messageID: "message-1",
    text: "Sample text content",
    ...overrides,
  } as Part;
}

/**
 * Create a reasoning part for testing
 */
export function createReasoningPart(overrides?: Partial<Part>): Part {
  return {
    id: "reasoning-part-1",
    type: "reasoning",
    messageID: "message-1",
    text: "Let me think about this...",
    ...overrides,
  } as Part;
}

/**
 * Create a tool part for testing
 */
export function createToolPart(tool: string, status: string, overrides?: Partial<Part>): Part {
  return {
    id: `tool-part-${tool}`,
    type: "tool",
    messageID: "message-1",
    tool,
    state: { status },
    output: status === "completed" ? "Tool output" : undefined,
    ...overrides,
  } as Part;
}

/**
 * Create an error tool part for testing
 */
export function createErrorToolPart(tool: string, error: string, overrides?: Partial<Part>): Part {
  return {
    id: `tool-part-${tool}-error`,
    type: "tool",
    messageID: "message-1",
    tool,
    state: { status: "error", error },
    ...overrides,
  } as Part;
}

/**
 * Create a retry part for testing
 */
export function createRetryPart(overrides?: Partial<Part>): Part {
  const now = Date.now();
  return {
    id: "retry-part-1",
    type: "retry",
    messageID: "message-1",
    sessionID: "session-1",
    attempt: 1,
    next: now + 3000,
    error: {
      message: "Cannot connect to API: other side closed",
      isRetryable: true,
      metadata: { kind: "socket_closed" },
    },
    time: { created: now, start: now, end: now },
    ...overrides,
  } as Part;
}
