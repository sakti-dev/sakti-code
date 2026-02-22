/**
 * Test Fixtures for Data Integrity Tests
 *
 * Shared test data and utilities for consistent testing across all data integrity tests.
 */

import type { ServerEvent } from "@sakti-code/shared/event-types";
import { v7 as uuidv7 } from "uuid";

// ============================================================================
// Sample Data
// ============================================================================

export const sampleWorkspace = "/test/workspace";
export const sampleDirectory = "/test/workspace/project";

export function createSampleSession(sessionId?: string) {
  return {
    sessionID: sessionId || uuidv7(),
    directory: sampleDirectory,
  };
}

export function createSampleMessage(messageId?: string, sessionId?: string) {
  return {
    id: messageId || uuidv7(),
    role: "user" as const,
    sessionID: sessionId || uuidv7(),
    time: { created: Date.now() },
  };
}

export function createSamplePart(partId?: string, messageId?: string, sessionId?: string) {
  return {
    id: partId || uuidv7(),
    type: "text",
    messageID: messageId || uuidv7(),
    sessionID: sessionId || uuidv7(),
    text: "Sample text content",
    time: { start: Date.now(), end: Date.now() },
  };
}

// ============================================================================
// Event Factories
// ============================================================================

export function createSessionCreatedEvent(
  sessionId: string,
  sequence = 1,
  overrides?: Partial<ServerEvent>
): ServerEvent {
  return {
    type: "session.created",
    properties: {
      sessionID: sessionId,
      directory: sampleDirectory,
    },
    eventId: uuidv7(),
    sequence,
    timestamp: Date.now(),
    sessionID: sessionId,
    ...overrides,
  } as ServerEvent;
}

export function createMessageUpdatedEvent(
  messageId: string,
  sessionId: string,
  sequence: number,
  overrides?: Partial<ServerEvent>
): ServerEvent {
  return {
    type: "message.updated",
    properties: {
      info: {
        id: messageId,
        role: "user",
        sessionID: sessionId,
        time: { created: Date.now() },
      },
    },
    eventId: uuidv7(),
    sequence,
    timestamp: Date.now(),
    sessionID: sessionId,
    ...overrides,
  } as ServerEvent;
}

export function createPartUpdatedEvent(
  partId: string,
  messageId: string,
  sessionId: string,
  sequence: number,
  overrides?: Partial<ServerEvent>
): ServerEvent {
  return {
    type: "message.part.updated",
    properties: {
      part: {
        id: partId,
        type: "text",
        messageID: messageId,
        sessionID: sessionId,
        text: "Part content",
      },
    },
    eventId: uuidv7(),
    sequence,
    timestamp: Date.now(),
    sessionID: sessionId,
    ...overrides,
  } as ServerEvent;
}

export function createSessionStatusEvent(
  sessionId: string,
  status: { type: "idle" } | { type: "busy" },
  sequence: number,
  overrides?: Partial<ServerEvent>
): ServerEvent {
  return {
    type: "session.status",
    properties: {
      sessionID: sessionId,
      status,
    },
    eventId: uuidv7(),
    sequence,
    timestamp: Date.now(),
    sessionID: sessionId,
    ...overrides,
  } as ServerEvent;
}

// ============================================================================
// Event Sequence Builders
// ============================================================================

export function createOrderedEventSequence(
  sessionId: string,
  messageId: string,
  partId: string
): ServerEvent[] {
  return [
    createSessionCreatedEvent(sessionId, 1),
    createMessageUpdatedEvent(messageId, sessionId, 2),
    createPartUpdatedEvent(partId, messageId, sessionId, 3),
    createSessionStatusEvent(sessionId, { type: "busy" }, 4),
  ];
}

export function createOutOfOrderEventSequence(
  sessionId: string,
  messageId: string,
  partId: string
): ServerEvent[] {
  // Return in wrong order: part, message, session, status
  return [
    createPartUpdatedEvent(partId, messageId, sessionId, 3),
    createMessageUpdatedEvent(messageId, sessionId, 2),
    createSessionCreatedEvent(sessionId, 1),
    createSessionStatusEvent(sessionId, { type: "busy" }, 4),
  ];
}

export function createEventsWithGap(
  sessionId: string,
  messageId: string
): { events: ServerEvent[]; missingSequence: number } {
  return {
    events: [
      createSessionCreatedEvent(sessionId, 1),
      // Sequence 2 is missing
      createMessageUpdatedEvent(messageId, sessionId, 3),
      createSessionStatusEvent(sessionId, { type: "busy" }, 4),
    ],
    missingSequence: 2,
  };
}

// ============================================================================
// Validation Helpers
// ============================================================================

export interface StoreIntegrityReport {
  valid: boolean;
  errors: string[];
  orphanedMessages: string[];
  orphanedParts: string[];
  missingSessions: string[];
}

export function validateStoreIntegrity(stores: {
  session: { byId: Record<string, unknown> };
  message: { byId: Record<string, { sessionID?: string }>; bySession: Record<string, string[]> };
  part: {
    byId: Record<string, { messageID?: string; sessionID?: string }>;
    byMessage: Record<string, string[]>;
  };
}): StoreIntegrityReport {
  const errors: string[] = [];
  const orphanedMessages: string[] = [];
  const orphanedParts: string[] = [];
  const missingSessions: string[] = [];

  // Check all messages have valid sessions
  for (const [messageId, message] of Object.entries(stores.message.byId)) {
    if (!message.sessionID) {
      errors.push(`Message ${messageId} has no sessionID`);
      continue;
    }
    if (!stores.session.byId[message.sessionID]) {
      errors.push(`Message ${messageId} references non-existent session ${message.sessionID}`);
      orphanedMessages.push(messageId);
      if (!missingSessions.includes(message.sessionID)) {
        missingSessions.push(message.sessionID);
      }
    }
  }

  // Check all parts have valid messages and sessions
  for (const [partId, part] of Object.entries(stores.part.byId)) {
    if (!part.messageID) {
      errors.push(`Part ${partId} has no messageID`);
      continue;
    }
    if (!stores.message.byId[part.messageID]) {
      errors.push(`Part ${partId} references non-existent message ${part.messageID}`);
      orphanedParts.push(partId);
    }
    if (part.sessionID && !stores.session.byId[part.sessionID]) {
      errors.push(`Part ${partId} references non-existent session ${part.sessionID}`);
      if (!missingSessions.includes(part.sessionID)) {
        missingSessions.push(part.sessionID);
      }
    }
  }

  // Check session message lists are consistent
  for (const [sessionId, messageIds] of Object.entries(stores.message.bySession)) {
    for (const messageId of messageIds) {
      if (!stores.message.byId[messageId]) {
        errors.push(`Session ${sessionId} references non-existent message ${messageId}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    orphanedMessages,
    orphanedParts,
    missingSessions,
  };
}

// ============================================================================
// Async Helpers
// ============================================================================

export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function waitForCondition(
  condition: () => boolean,
  timeout = 5000,
  interval = 50
): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < timeout) {
    if (condition()) {
      return;
    }
    await wait(interval);
  }
  throw new Error(`Timeout waiting for condition after ${timeout}ms`);
}

// ============================================================================
// Mock API Client
// ============================================================================

export interface MockChatResponse {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
}

export function createMockChatResponse(overrides?: Partial<MockChatResponse>): MockChatResponse {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: new Headers(),
    body: null,
    ...overrides,
  };
}

export function createStreamResponse(chunks: string[]): MockChatResponse {
  const encoder = new TextEncoder();
  let index = 0;

  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });

  return createMockChatResponse({ body: stream });
}
