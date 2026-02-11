/**
 * Stream Parser Service
 *
 * Parses SSE event data using type guards.
 * Provides error handling and recovery for malformed events.
 */

import { isKnownEventType, isRecord, isString } from "@ekacode/shared/event-guards";
import type { EventMap, EventType } from "@ekacode/shared/event-types";

// Re-export the type to avoid circular dependency
export type TypedSSEEvent = {
  type: EventType;
  properties: EventMap[EventType];
  directory?: string;
};

export interface ParseResult {
  success: boolean;
  event?: TypedSSEEvent;
  error?: string;
}

export interface StreamParserMetrics {
  totalParsed: number;
  totalErrors: number;
  lastError?: string;
}

export interface StreamParserService {
  parse: (data: string) => ParseResult;
  parseMessageEvent: (evt: MessageEvent) => ParseResult;
  getMetrics: () => StreamParserMetrics;
}

/**
 * Type guards for specific event types
 */
function isSessionCreatedEvent(value: unknown): value is {
  type: "session.created";
  properties: EventMap["session.created"];
  directory?: string;
} {
  if (!isRecord(value)) return false;
  if (value.type !== "session.created") return false;
  if (!isRecord(value.properties)) return false;
  return isString(value.properties.sessionID) && isString(value.properties.directory);
}

function isMessageCreatedEvent(value: unknown): value is {
  type: "message.updated";
  properties: EventMap["message.updated"];
  directory?: string;
} {
  if (!isRecord(value)) return false;
  if (value.type !== "message.updated") return false;
  if (!isRecord(value.properties)) return false;
  return isRecord(value.properties.info);
}

function isPartCreatedEvent(value: unknown): value is {
  type: "message.part.updated";
  properties: EventMap["message.part.updated"];
  directory?: string;
} {
  if (!isRecord(value)) return false;
  if (value.type !== "message.part.updated") return false;
  if (!isRecord(value.properties)) return false;
  return isRecord(value.properties.part);
}

function isSessionStatusEvent(
  value: unknown
): value is { type: "session.status"; properties: EventMap["session.status"]; directory?: string } {
  if (!isRecord(value)) return false;
  if (value.type !== "session.status") return false;
  if (!isRecord(value.properties)) return false;
  return isString(value.properties.sessionID) && isRecord(value.properties.status);
}

function isSessionUpdatedEvent(value: unknown): value is {
  type: "session.updated";
  properties: EventMap["session.updated"];
  directory?: string;
} {
  if (!isRecord(value)) return false;
  if (value.type !== "session.updated") return false;
  if (!isRecord(value.properties)) return false;
  if (!isString(value.properties.sessionID)) return false;
  return (
    value.properties.status === "idle" ||
    value.properties.status === "running" ||
    value.properties.status === "error"
  );
}

function isPermissionAskedEvent(value: unknown): value is {
  type: "permission.asked";
  properties: EventMap["permission.asked"];
  directory?: string;
} {
  if (!isRecord(value)) return false;
  if (value.type !== "permission.asked") return false;
  if (!isRecord(value.properties)) return false;
  return isString(value.properties.id) && isString(value.properties.sessionID);
}

function isPermissionRepliedEvent(value: unknown): value is {
  type: "permission.replied";
  properties: EventMap["permission.replied"];
  directory?: string;
} {
  if (!isRecord(value)) return false;
  if (value.type !== "permission.replied") return false;
  if (!isRecord(value.properties)) return false;
  return isString(value.properties.sessionID) && isString(value.properties.requestID);
}

function isQuestionAskedEvent(
  value: unknown
): value is { type: "question.asked"; properties: EventMap["question.asked"]; directory?: string } {
  if (!isRecord(value)) return false;
  if (value.type !== "question.asked") return false;
  if (!isRecord(value.properties)) return false;
  return (
    isString(value.properties.id) &&
    isString(value.properties.sessionID) &&
    Array.isArray(value.properties.questions)
  );
}

function isQuestionRepliedEvent(value: unknown): value is {
  type: "question.replied";
  properties: EventMap["question.replied"];
  directory?: string;
} {
  if (!isRecord(value)) return false;
  if (value.type !== "question.replied") return false;
  if (!isRecord(value.properties)) return false;
  return isString(value.properties.sessionID) && isString(value.properties.requestID);
}

function isQuestionRejectedEvent(value: unknown): value is {
  type: "question.rejected";
  properties: EventMap["question.rejected"];
  directory?: string;
} {
  if (!isRecord(value)) return false;
  if (value.type !== "question.rejected") return false;
  if (!isRecord(value.properties)) return false;
  return isString(value.properties.sessionID) && isString(value.properties.requestID);
}

function isServerConnectedEvent(value: unknown): value is {
  type: "server.connected";
  properties: EventMap["server.connected"];
  directory?: string;
} {
  if (!isRecord(value)) return false;
  return value.type === "server.connected";
}

function isServerHeartbeatEvent(value: unknown): value is {
  type: "server.heartbeat";
  properties: EventMap["server.heartbeat"];
  directory?: string;
} {
  if (!isRecord(value)) return false;
  return value.type === "server.heartbeat";
}

function isServerInstanceDisposedEvent(value: unknown): value is {
  type: "server.instance.disposed";
  properties: EventMap["server.instance.disposed"];
  directory?: string;
} {
  if (!isRecord(value)) return false;
  if (value.type !== "server.instance.disposed") return false;
  if (!isRecord(value.properties)) return false;
  return isString(value.properties.directory);
}

function isMessagePartRemovedEvent(value: unknown): value is {
  type: "message.part.removed";
  properties: EventMap["message.part.removed"];
  directory?: string;
} {
  if (!isRecord(value)) return false;
  if (value.type !== "message.part.removed") return false;
  if (!isRecord(value.properties)) return false;
  return (
    isString(value.properties.partID) &&
    isString(value.properties.messageID) &&
    isString(value.properties.sessionID)
  );
}

export function createStreamParser(): StreamParserService {
  const metrics: StreamParserMetrics = {
    totalParsed: 0,
    totalErrors: 0,
  };

  const parse = (data: string): ParseResult => {
    try {
      const parsed = JSON.parse(data) as unknown;

      // Validate basic structure
      if (!isRecord(parsed) || !isString(parsed.type)) {
        metrics.totalErrors += 1;
        metrics.lastError = "Invalid event structure: missing type";
        return {
          success: false,
          error: metrics.lastError,
        };
      }

      // Check if it's a known event type
      if (!isKnownEventType(parsed.type)) {
        metrics.totalErrors += 1;
        metrics.lastError = `Unknown event type: ${parsed.type}`;
        return {
          success: false,
          error: metrics.lastError,
        };
      }

      // Try type guards for each event type
      if (isServerConnectedEvent(parsed)) {
        metrics.totalParsed += 1;
        return { success: true, event: parsed };
      }

      if (isServerHeartbeatEvent(parsed)) {
        metrics.totalParsed += 1;
        return { success: true, event: parsed };
      }

      if (isServerInstanceDisposedEvent(parsed)) {
        metrics.totalParsed += 1;
        return { success: true, event: parsed };
      }

      if (isSessionCreatedEvent(parsed)) {
        metrics.totalParsed += 1;
        return { success: true, event: parsed };
      }

      if (isSessionUpdatedEvent(parsed)) {
        metrics.totalParsed += 1;
        return { success: true, event: parsed };
      }

      if (isMessageCreatedEvent(parsed)) {
        metrics.totalParsed += 1;
        return { success: true, event: parsed };
      }

      if (isPartCreatedEvent(parsed)) {
        metrics.totalParsed += 1;
        return { success: true, event: parsed };
      }

      if (isMessagePartRemovedEvent(parsed)) {
        metrics.totalParsed += 1;
        return { success: true, event: parsed };
      }

      if (isSessionStatusEvent(parsed)) {
        metrics.totalParsed += 1;
        return { success: true, event: parsed };
      }

      if (isPermissionAskedEvent(parsed)) {
        metrics.totalParsed += 1;
        return { success: true, event: parsed };
      }

      if (isPermissionRepliedEvent(parsed)) {
        metrics.totalParsed += 1;
        return { success: true, event: parsed };
      }

      if (isQuestionAskedEvent(parsed)) {
        metrics.totalParsed += 1;
        return { success: true, event: parsed };
      }

      if (isQuestionRepliedEvent(parsed)) {
        metrics.totalParsed += 1;
        return { success: true, event: parsed };
      }

      if (isQuestionRejectedEvent(parsed)) {
        metrics.totalParsed += 1;
        return { success: true, event: parsed };
      }

      metrics.totalErrors += 1;
      metrics.lastError = `Event type known but validation failed: ${parsed.type}`;
      return {
        success: false,
        error: metrics.lastError,
      };
    } catch (error) {
      metrics.totalErrors += 1;
      metrics.lastError = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Parse error: ${metrics.lastError}`,
      };
    }
  };

  const parseMessageEvent = (evt: MessageEvent): ParseResult => {
    // lastEventId is stored for resume capability
    // In a full implementation, this would be persisted
    return parse(evt.data);
  };

  const getMetrics = () => ({ ...metrics });

  return {
    parse,
    parseMessageEvent,
    getMetrics,
  };
}
