/**
 * Test helpers for event handling parity tests
 *
 * These utilities were extracted from the old global-sync-provider.ts
 * to support E2E parity testing without requiring the old provider code.
 */

import type { Part } from "@/core/chat/types/sync";
import type { ServerEvent } from "@sakti-code/shared/event-types";
import { produce } from "solid-js/store";

/**
 * Directory store type for testing
 */
export interface DirectoryStore {
  ready: boolean;
  session: Array<{
    sessionId: string;
    resourceId: string;
    threadId?: string;
    createdAt: number;
    lastAccessed: number;
  }>;
  message: Record<
    string,
    Array<{
      info: {
        id: string;
        role: "user" | "assistant" | "system";
        sessionID?: string;
        time?: { created: number; completed?: number };
        parentID?: string;
        model?: string;
        provider?: string;
      };
      parts: Part[];
      createdAt?: number;
      updatedAt?: number;
    }>
  >;
  part: Record<string, Part[]>;
  sessionStatus: Record<string, { status: { type: string } }>;
  permission: Record<
    string,
    Array<{
      id: string;
      sessionID: string;
      permission: string;
      patterns: string[];
      tool?: { messageID: string; callID: string };
    }>
  >;
  question: Record<
    string,
    Array<{
      id: string;
      sessionID: string;
      questions: unknown[];
      tool?: { messageID: string; callID: string };
    }>
  >;
  limit: number;
}

/**
 * Initial directory store state
 */
export function createInitialDirectoryStore(): DirectoryStore {
  return {
    ready: false,
    session: [],
    message: {},
    part: {},
    sessionStatus: {},
    permission: {},
    question: {},
    limit: 100,
  };
}

export type StoreUpdaterFunction = (
  ...args:
    | [Partial<DirectoryStore>]
    | [string, unknown]
    | [string, number, unknown]
    | [string, string, unknown]
    | [string, number, number, unknown]
    | [string, string, number, unknown]
    | [string, (current: unknown) => unknown]
    | [string, string, (current: unknown) => unknown]
    | [(store: DirectoryStore) => DirectoryStore]
) => void;

/**
 * Apply directory event handler
 * Extracted from global-sync-provider for testing parity
 */
export function applyDirectoryEvent(input: {
  event: ServerEvent<string, Record<string, unknown>>;
  store: DirectoryStore;
  setStore: StoreUpdaterFunction;
}): void {
  const { event, store, setStore } = input;

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  function normalizeMessageRole(role: unknown): "user" | "assistant" | "system" {
    if (role === "user" || role === "assistant" || role === "system") return role;
    return "assistant";
  }

  function parseSession(input: unknown):
    | {
        sessionId: string;
        resourceId: string;
        threadId?: string;
        createdAt: number;
        lastAccessed: number;
      }
    | undefined {
    if (!isRecord(input)) return undefined;

    const sessionId =
      typeof input.sessionId === "string"
        ? input.sessionId
        : typeof input.id === "string"
          ? input.id
          : undefined;
    if (!sessionId) return undefined;

    const createdAtRaw =
      typeof input.createdAt === "number"
        ? input.createdAt
        : typeof input.createdAt === "string"
          ? Date.parse(input.createdAt)
          : undefined;
    const lastAccessedRaw =
      typeof input.lastAccessed === "number"
        ? input.lastAccessed
        : typeof input.lastAccessed === "string"
          ? Date.parse(input.lastAccessed)
          : undefined;

    return {
      sessionId,
      resourceId: typeof input.resourceId === "string" ? input.resourceId : "local",
      threadId: typeof input.threadId === "string" ? input.threadId : undefined,
      createdAt: Number.isFinite(createdAtRaw) ? (createdAtRaw as number) : Date.now(),
      lastAccessed: Number.isFinite(lastAccessedRaw) ? (lastAccessedRaw as number) : Date.now(),
    };
  }

  function parseMessageInfo(input: unknown):
    | {
        id: string;
        role: "user" | "assistant" | "system";
        sessionID?: string;
        time?: { created: number; completed?: number };
        parentID?: string;
        model?: string;
        provider?: string;
      }
    | undefined {
    if (!isRecord(input)) return undefined;
    if (typeof input.id !== "string") return undefined;

    const time = isRecord(input.time)
      ? {
          created: typeof input.time.created === "number" ? input.time.created : Date.now(),
          completed: typeof input.time.completed === "number" ? input.time.completed : undefined,
        }
      : undefined;

    return {
      id: input.id,
      role: normalizeMessageRole(input.role),
      sessionID: typeof input.sessionID === "string" ? input.sessionID : undefined,
      time,
      parentID: typeof input.parentID === "string" ? input.parentID : undefined,
      model:
        typeof input.model === "string"
          ? input.model
          : typeof input.modelID === "string"
            ? input.modelID
            : undefined,
      provider:
        typeof input.provider === "string"
          ? input.provider
          : typeof input.providerID === "string"
            ? input.providerID
            : undefined,
    };
  }

  function Binary<T>(
    array: T[],
    value: string,
    select: (item: T) => string
  ): { found: boolean; index: number } {
    let lo = 0;
    let hi = array.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const diff = select(array[mid]).localeCompare(value);
      if (diff < 0) lo = mid + 1;
      else if (diff > 0) hi = mid;
      else return { found: true, index: mid };
    }
    return { found: false, index: lo };
  }

  type Message = {
    info: {
      id: string;
      role: "user" | "assistant" | "system";
      sessionID?: string;
      time?: { created: number; completed?: number };
      parentID?: string;
      model?: string;
      provider?: string;
    };
    parts: Part[];
    createdAt?: number;
    updatedAt?: number;
  };

  type Session = {
    sessionId: string;
    resourceId: string;
    threadId?: string;
    createdAt: number;
    lastAccessed: number;
  };

  type PermissionRequest = {
    id: string;
    sessionID: string;
    permission: string;
    patterns: string[];
    tool?: { messageID: string; callID: string };
  };

  type QuestionRequest = {
    id: string;
    sessionID: string;
    questions: unknown[];
    tool?: { messageID: string; callID: string };
  };

  const _cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

  switch (event.type) {
    case "session.created": {
      const props: Record<string, unknown> = isRecord(event.properties) ? event.properties : {};
      const parsed = parseSession(props.info);
      const sessionID = typeof props.sessionID === "string" ? props.sessionID : undefined;
      const session =
        parsed ??
        (sessionID
          ? {
              sessionId: sessionID,
              resourceId: "local",
              createdAt: Date.now(),
              lastAccessed: Date.now(),
            }
          : undefined);
      if (!session) break;

      const result = Binary(store.session, session.sessionId, (s: Session) => s.sessionId);
      if (result.found) {
        setStore("session", result.index, session);
      } else {
        const next = [...store.session];
        next.splice(result.index, 0, session);
        setStore("session", next);
      }
      break;
    }

    case "session.updated": {
      const props: Record<string, unknown> = isRecord(event.properties) ? event.properties : {};
      const parsed = parseSession(props.info);
      if (!parsed) break;

      const result = Binary(store.session, parsed.sessionId, (s: Session) => s.sessionId);
      if (result.found) {
        setStore("session", result.index, parsed);
      } else {
        const next = [...store.session];
        next.splice(result.index, 0, parsed);
        setStore("session", next);
      }
      break;
    }

    case "session.status": {
      const props: Record<string, unknown> = isRecord(event.properties) ? event.properties : {};
      const sessionID = typeof props.sessionID === "string" ? props.sessionID : undefined;
      const status = isRecord(props.status) ? (props.status as SessionStatus["status"]) : undefined;
      if (!sessionID || !status) break;
      setStore("sessionStatus", sessionID, { status });
      break;
    }

    case "message.updated": {
      const props: Record<string, unknown> = isRecord(event.properties) ? event.properties : {};
      const info = parseMessageInfo(props.info);
      if (!info) break;
      const sessionID = info.sessionID;
      if (!sessionID) break;

      const messages = store.message[sessionID];
      if (!messages) {
        const existingParts = store.part[info.id] ?? [];
        const newMessage: Message = {
          info,
          parts: existingParts,
          createdAt: info.time?.created,
          updatedAt: Date.now(),
        };
        setStore("message", sessionID, [newMessage]);
        break;
      }

      const result = Binary(messages, info.id, (m: Message) => m.info.id);
      const existingMessage = result.found ? messages[result.index] : undefined;
      const newMessage: Message = {
        info,
        parts: store.part[info.id] ?? existingMessage?.parts ?? [],
        createdAt: existingMessage?.createdAt ?? info.time?.created,
        updatedAt: Date.now(),
      };

      if (result.found) {
        setStore("message", sessionID, result.index, newMessage);
      } else {
        const next = [...messages];
        next.splice(result.index, 0, newMessage);
        setStore("message", sessionID, next);
      }
      break;
    }

    case "message.part.updated": {
      const props: Record<string, unknown> = isRecord(event.properties) ? event.properties : {};
      const part = isRecord(props.part) ? (props.part as Part) : undefined;
      if (
        !part ||
        typeof part.id !== "string" ||
        typeof part.messageID !== "string" ||
        typeof part.sessionID !== "string"
      ) {
        break;
      }

      const parts = store.part[part.messageID];
      if (!parts) {
        setStore("part", part.messageID, [part]);
        break;
      }

      const result = Binary(parts, part.id, (p: Part) => p.id);
      if (result.found) {
        setStore("part", part.messageID, result.index, part);
      } else {
        const next = [...parts];
        next.splice(result.index, 0, part);
        setStore("part", part.messageID, next);
      }
      break;
    }

    case "message.part.removed": {
      const props: Record<string, unknown> = isRecord(event.properties) ? event.properties : {};
      const messageID = typeof props.messageID === "string" ? props.messageID : undefined;
      const partID = typeof props.partID === "string" ? props.partID : undefined;
      if (!messageID || !partID) break;

      const parts = store.part[messageID];
      if (!parts) break;

      const result = Binary(parts, partID, (p: Part) => p.id);
      if (!result.found) break;

      setStore(
        produce(draft => {
          const list = draft.part[messageID];
          if (!list) return;
          const next = Binary(list, partID, (p: Part) => p.id);
          if (!next.found) return;
          list.splice(next.index, 1);
          if (list.length === 0) delete draft.part[messageID];
        })
      );
      break;
    }

    case "permission.asked": {
      const props: Record<string, unknown> = isRecord(event.properties) ? event.properties : {};
      const tool =
        isRecord(props.tool) &&
        typeof props.tool.messageID === "string" &&
        typeof props.tool.callID === "string"
          ? {
              messageID: props.tool.messageID,
              callID: props.tool.callID,
            }
          : undefined;
      const permission =
        typeof props.id === "string" &&
        typeof props.sessionID === "string" &&
        typeof props.permission === "string" &&
        Array.isArray(props.patterns)
          ? ({
              id: props.id,
              sessionID: props.sessionID,
              permission: props.permission,
              patterns: props.patterns.filter(
                (value): value is string => typeof value === "string"
              ),
              tool,
            } satisfies PermissionRequest)
          : undefined;
      if (!permission) break;

      const permissions = store.permission[permission.sessionID];
      if (!permissions) {
        setStore("permission", permission.sessionID, [permission]);
        break;
      }

      const result = Binary(permissions, permission.id, (p: PermissionRequest) => p.id);
      if (result.found) {
        setStore("permission", permission.sessionID, result.index, permission);
      } else {
        const next = [...permissions];
        next.splice(result.index, 0, permission);
        setStore("permission", permission.sessionID, next);
      }
      break;
    }

    case "permission.replied": {
      const props: Record<string, unknown> = isRecord(event.properties) ? event.properties : {};
      const sessionID = typeof props.sessionID === "string" ? props.sessionID : undefined;
      const requestID = typeof props.requestID === "string" ? props.requestID : undefined;
      if (!sessionID || !requestID) break;

      const permissions = store.permission[sessionID];
      if (!permissions) break;

      const result = Binary(permissions, requestID, (p: PermissionRequest) => p.id);
      if (!result.found) break;

      const next = [...permissions];
      next.splice(result.index, 1);
      setStore("permission", sessionID, next);
      break;
    }

    case "question.asked": {
      const props: Record<string, unknown> = isRecord(event.properties) ? event.properties : {};
      const tool =
        isRecord(props.tool) &&
        typeof props.tool.messageID === "string" &&
        typeof props.tool.callID === "string"
          ? {
              messageID: props.tool.messageID,
              callID: props.tool.callID,
            }
          : undefined;
      const question =
        typeof props.id === "string" &&
        typeof props.sessionID === "string" &&
        Array.isArray(props.questions)
          ? ({
              id: props.id,
              sessionID: props.sessionID,
              questions: props.questions,
              tool,
            } satisfies QuestionRequest)
          : undefined;
      if (!question) break;

      const questions = store.question[question.sessionID];
      if (!questions) {
        setStore("question", question.sessionID, [question]);
        break;
      }

      const result = Binary(questions, question.id, (q: QuestionRequest) => q.id);
      if (result.found) {
        setStore("question", question.sessionID, result.index, question);
      } else {
        const next = [...questions];
        next.splice(result.index, 0, question);
        setStore("question", question.sessionID, next);
      }
      break;
    }

    case "question.replied":
    case "question.rejected": {
      const props: Record<string, unknown> = isRecord(event.properties) ? event.properties : {};
      const sessionID = typeof props.sessionID === "string" ? props.sessionID : undefined;
      const requestID = typeof props.requestID === "string" ? props.requestID : undefined;
      if (!sessionID || !requestID) break;

      const questions = store.question[sessionID];
      if (!questions) break;

      const result = Binary(questions, requestID, (q: QuestionRequest) => q.id);
      if (!result.found) break;

      const next = [...questions];
      next.splice(result.index, 1);
      setStore("question", sessionID, next);
      break;
    }
  }

  if (!store.ready) {
    setStore("ready", true);
  }
}

// Missing type for SessionStatus
type SessionStatus = { status: { type: string } };
