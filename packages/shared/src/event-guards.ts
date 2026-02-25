/**
 * SSE Event Type Guards
 *
 * Runtime validation for SSE event payloads.
 * Provides type-safe event parsing with Zod validation.
 * Updated for Batch 2: Data Integrity - includes strict validation of integrity fields
 */

import { z } from "zod";
import type { EventIntegrityFields, EventMap, EventType } from "./event-types";

/**
 * Check if value is a non-null object (excluding arrays)
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Check if value is a string
 */
export function isString(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * All known event type names
 */
const KNOWN_EVENT_TYPES: ReadonlyArray<EventType> = [
  "server.connected",
  "server.heartbeat",
  "server.instance.disposed",
  "message.updated",
  "message.part.updated",
  "message.part.removed",
  "session.created",
  "session.updated",
  "session.status",
  "permission.asked",
  "permission.replied",
  "question.asked",
  "question.replied",
  "question.rejected",
  "task.updated",
  "task-session.updated",
];

/**
 * Type guard for known event types
 */
export function isKnownEventType(value: string): value is EventType {
  return KNOWN_EVENT_TYPES.includes(value as EventType);
}

/**
 * Get all known event types
 */
export function getKnownEventTypes(): ReadonlyArray<EventType> {
  return KNOWN_EVENT_TYPES;
}

// ============================================================================
// Event Integrity Validation (Batch 2: Data Integrity)
// ============================================================================

/**
 * UUIDv7 regex pattern for validation
 */
const UUIDV7_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Zod schema for event integrity fields
 * All fields are required for data integrity
 */
export const EventIntegritySchema = z.object({
  eventId: z.string().regex(UUIDV7_REGEX, "eventId must be a valid UUIDv7"),
  sequence: z.number().int().min(0, "sequence must be a non-negative integer"),
  timestamp: z.number().int().positive("timestamp must be a positive integer"),
  sessionID: z.string().regex(UUIDV7_REGEX, "sessionID must be a valid UUIDv7").optional(),
});

/**
 * Zod schema for basic ServerEvent structure with integrity fields
 */
export const ServerEventSchema = z
  .object({
    type: z.string(),
    properties: z.record(z.string(), z.unknown()),
    directory: z.string().optional(),
  })
  .merge(EventIntegritySchema);

/**
 * Type guard for ServerEvent structure
 */
export function isServerEvent(value: unknown): value is { type: string; properties: unknown } {
  if (!isRecord(value)) return false;
  return "type" in value && isString(value.type) && "properties" in value;
}

/**
 * Type guard for EventIntegrityFields
 * All fields must be present and valid
 */
export function hasIntegrityFields(value: unknown): value is EventIntegrityFields {
  if (!isRecord(value)) return false;

  const hasEventId =
    "eventId" in value && isString(value.eventId) && UUIDV7_REGEX.test(value.eventId);
  const hasSequence =
    "sequence" in value &&
    typeof value.sequence === "number" &&
    Number.isInteger(value.sequence) &&
    value.sequence >= 0;
  const hasTimestamp =
    "timestamp" in value && typeof value.timestamp === "number" && value.timestamp > 0;

  return hasEventId && hasSequence && hasTimestamp;
}

/**
 * Validates event integrity fields
 * @returns Validation result with detailed error if invalid
 */
export function validateIntegrityFields(value: unknown): {
  valid: boolean;
  fields?: EventIntegrityFields;
  error?: string;
} {
  const result = EventIntegritySchema.safeParse(value);
  if (!result.success) {
    return {
      valid: false,
      error: result.error.issues.map((e: { message: string }) => e.message).join(", "),
    };
  }
  return { valid: true, fields: result.data };
}

/**
 * Parse SSE event data with validation
 * Now includes strict validation of integrity fields
 *
 * @param data - Raw event data (string from SSE or parsed object)
 * @param options - Parsing options
 * @param options.requireIntegrity - Whether to require integrity fields (default: true)
 * @returns { success: true, event } or { success: false, error }
 */
export function parseServerEvent(data: unknown): {
  success: boolean;
  event?: {
    type: string;
    properties: Record<string, unknown>;
    directory?: string;
    eventId: string;
    sequence: number;
    timestamp: number;
    sessionID?: string;
  };
  error?: string;
} {
  try {
    // Handle string data from SSE
    const parsed = typeof data === "string" ? JSON.parse(data) : data;

    // Validate basic structure (includes integrity fields)
    const result = ServerEventSchema.safeParse(parsed);
    if (!result.success) {
      return {
        success: false,
        error: result.error.issues.map((e: { message: string }) => e.message).join(", "),
      };
    }

    return { success: true, event: result.data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown parsing error",
    };
  }
}

/**
 * Check if event type matches a specific type
 */
export function isEventType<K extends EventType>(
  event: { type: string },
  eventType: K
): event is { type: K } {
  return event.type === eventType;
}

/**
 * Type-safe payload extractor
 *
 * @example
 * const event = parseServerEvent(data);
 * if (event.success && isEventType(event.event, "message.updated")) {
 *   const payload = getPayload(event.event, "message.updated");
 *   // payload is typed as EventMap["message.updated"]
 * }
 */
export function getPayload<K extends EventType>(
  event: { type: string; properties: Record<string, unknown> },
  eventType: K
): EventMap[K] | undefined {
  if (event.type !== eventType) return undefined;
  // Cast through unknown to bypass the type overlap check
  return event.properties as unknown as EventMap[K];
}

// ============================================================================
// Event-Specific Payload Validation (Batch 2: Data Integrity)
// ============================================================================

/**
 * Zod schema for message info validation
 */
const MessageInfoSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "system"]),
  sessionID: z.string().regex(UUIDV7_REGEX).optional(),
  parentID: z.string().optional(),
  time: z
    .object({
      created: z.number().optional(),
      updated: z.number().optional(),
    })
    .optional(),
});

/**
 * Zod schema for part validation
 */
const PartSchema = z.object({
  id: z.string(),
  type: z.string(),
  messageID: z.string().optional(),
  sessionID: z.string().regex(UUIDV7_REGEX).optional(),
  text: z.string().optional(),
});

/**
 * Validates message.updated event payload
 */
export function validateMessageUpdatedPayload(properties: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const result = z.object({ info: MessageInfoSchema }).safeParse(properties);
  if (!result.success) {
    return {
      valid: false,
      error: result.error.issues.map((e: { message: string }) => e.message).join(", "),
    };
  }
  return { valid: true };
}

/**
 * Validates message.part.updated event payload
 */
export function validateMessagePartUpdatedPayload(properties: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const result = z
    .object({
      part: PartSchema,
      delta: z.string().optional(),
    })
    .safeParse(properties);
  if (!result.success) {
    return {
      valid: false,
      error: result.error.issues.map((e: { message: string }) => e.message).join(", "),
    };
  }
  return { valid: true };
}

/**
 * Validates session.created event payload
 */
export function validateSessionCreatedPayload(properties: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const result = z
    .object({
      sessionID: z.string().regex(UUIDV7_REGEX),
      directory: z.string(),
    })
    .safeParse(properties);
  if (!result.success) {
    return {
      valid: false,
      error: result.error.issues.map((e: { message: string }) => e.message).join(", "),
    };
  }
  return { valid: true };
}

/**
 * Validates session.status event payload
 */
export function validateSessionStatusPayload(properties: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const result = z
    .object({
      sessionID: z.string().regex(UUIDV7_REGEX),
      status: z.union([
        z.object({ type: z.literal("idle") }),
        z.object({ type: z.literal("busy") }),
        z.object({
          type: z.literal("retry"),
          attempt: z.number(),
          message: z.string(),
          next: z.number(),
        }),
      ]),
    })
    .safeParse(properties);
  if (!result.success) {
    return {
      valid: false,
      error: result.error.issues.map((e: { message: string }) => e.message).join(", "),
    };
  }
  return { valid: true };
}

/**
 * Validates permission.asked event payload
 */
export function validatePermissionAskedPayload(properties: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const result = z
    .object({
      id: z.string(),
      sessionID: z.string().regex(UUIDV7_REGEX),
      permission: z.string(),
      patterns: z.array(z.string()),
      always: z.array(z.string()),
      metadata: z.record(z.string(), z.unknown()).optional(),
      tool: z
        .object({
          messageID: z.string(),
          callID: z.string(),
        })
        .optional(),
    })
    .safeParse(properties);
  if (!result.success) {
    return {
      valid: false,
      error: result.error.issues.map((e: { message: string }) => e.message).join(", "),
    };
  }
  return { valid: true };
}

/**
 * Validates question.asked event payload
 */
export function validateQuestionAskedPayload(properties: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const result = z
    .object({
      id: z.string(),
      sessionID: z.string().regex(UUIDV7_REGEX),
      questions: z.array(z.unknown()),
      tool: z
        .object({
          messageID: z.string(),
          callID: z.string(),
        })
        .optional(),
    })
    .safeParse(properties);
  if (!result.success) {
    return {
      valid: false,
      error: result.error.issues.map((e: { message: string }) => e.message).join(", "),
    };
  }
  return { valid: true };
}

/**
 * Comprehensive event validator that checks both structure and payload
 * @returns Detailed validation result
 */
export function validateEventComprehensive(data: unknown): {
  valid: boolean;
  event?: {
    type: EventType;
    properties: Record<string, unknown>;
    directory?: string;
    eventId: string;
    sequence: number;
    timestamp: number;
    sessionID?: string;
  };
  error?: string;
  integrity?: { valid: boolean; error?: string };
  payload?: { valid: boolean; error?: string };
} {
  // First validate structure and integrity
  const parseResult = parseServerEvent(data);
  if (!parseResult.success) {
    return { valid: false, error: parseResult.error };
  }

  const event = parseResult.event!;

  // Validate payload based on event type
  let payloadResult: { valid: boolean; error?: string };
  switch (event.type) {
    case "message.updated":
      payloadResult = validateMessageUpdatedPayload(event.properties);
      break;
    case "message.part.updated":
      payloadResult = validateMessagePartUpdatedPayload(event.properties);
      break;
    case "session.created":
      payloadResult = validateSessionCreatedPayload(event.properties);
      break;
    case "session.status":
      payloadResult = validateSessionStatusPayload(event.properties);
      break;
    case "permission.asked":
      payloadResult = validatePermissionAskedPayload(event.properties);
      break;
    case "question.asked":
      payloadResult = validateQuestionAskedPayload(event.properties);
      break;
    default:
      // For other event types, basic validation is sufficient
      payloadResult = { valid: true };
  }

  if (!payloadResult.valid) {
    return {
      valid: false,
      error: `Invalid payload: ${payloadResult.error}`,
      integrity: { valid: true },
      payload: payloadResult,
    };
  }

  return {
    valid: true,
    event: event as {
      type: EventType;
      properties: Record<string, unknown>;
      directory?: string;
      eventId: string;
      sequence: number;
      timestamp: number;
      sessionID?: string;
    },
    integrity: { valid: true },
    payload: { valid: true },
  };
}
