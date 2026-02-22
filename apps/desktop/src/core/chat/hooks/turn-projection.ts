/**
 * Turn Projection
 *
 * Pure projection functions that build ChatTurn model from normalized stores.
 * This is the core logic for OpenCode-like turn-based conversation layout.
 */

import type { MessageWithId } from "@/core/state/stores/message-store";
import type { PermissionRequest } from "@/core/state/stores/permission-store";
import type { QuestionRequest } from "@/core/state/stores/question-store";
import type { Part, SessionStatusPayload } from "@sakti-code/shared/event-types";

export interface TurnProjectionOptions {
  sessionId: string;
  messages: MessageWithId[];
  partsByMessage: Record<string, Part[]>;
  permissionRequests?: PermissionRequest[];
  questionRequests?: QuestionRequest[];
  sessionStatus?: SessionStatusPayload["status"];
  lastUserMessageId: string | undefined;
}

export interface ChatTurn {
  userMessage: MessageWithId;
  userParts: Part[];
  assistantMessages: MessageWithId[];
  assistantPartsByMessageId: Record<string, Part[]>;
  finalTextPart: Part | undefined;
  reasoningParts: Part[];
  toolParts: Part[];
  permissionParts: Part[];
  questionParts: Part[];
  orderedParts: Part[];
  isActiveTurn: boolean;
  working: boolean;
  retry:
    | {
        attempt: number;
        message: string;
        next: number;
      }
    | undefined;
  error: string | undefined;
  durationMs: number;
  statusLabel: string | undefined;
}

function getTimeField(message: MessageWithId, field: "created" | "completed"): number | undefined {
  const time = message.time;
  if (time && typeof time === "object" && field in time) {
    const value = (time as Record<string, unknown>)[field];
    return typeof value === "number" ? value : undefined;
  }
  return undefined;
}

function getErrorMessage(message: MessageWithId): string | undefined {
  const error = (message as Record<string, unknown>).error;
  if (error && typeof error === "object") {
    const data = (error as Record<string, unknown>).data;
    if (data && typeof data === "object") {
      const msg = (data as Record<string, unknown>).message;
      if (typeof msg === "string") return msg;
    }
    const msg = (error as Record<string, unknown>).message;
    if (typeof msg === "string") return msg;
  }
  if (typeof error === "string") return error;
  return undefined;
}

export function computeDuration(startMs: number | undefined, endMs: number | undefined): number {
  if (startMs === undefined) return 0;
  const end = endMs ?? Date.now();
  return Math.max(0, end - startMs);
}

export function deriveStatusFromPart(part: Part | undefined): string | undefined {
  if (!part) return undefined;

  if (part.type === "question" || part.type === "permission") {
    return "Waiting for input";
  }

  if (part.type === "reasoning") {
    return "Thinking";
  }

  if (part.type === "tool") {
    const toolName = (part as Record<string, unknown>).tool as string | undefined;
    switch (toolName) {
      case "read":
        return "Gathering context";
      case "ls":
      case "list":
      case "grep":
      case "glob":
        return "Searching codebase";
      case "webfetch":
        return "Searching web";
      case "task":
        return "Delegating work";
      case "todowrite":
      case "todoread":
        return "Planning next steps";
      case "edit":
      case "write":
      case "apply_patch":
      case "multiedit":
        return "Making edits";
      case "bash":
      case "shell":
        return "Running commands";
      case "question":
      case "permission":
        return "Waiting for input";
      default:
        return "Working";
    }
  }

  if (part.type === "text") {
    return "Gathering thoughts";
  }

  return undefined;
}

function findLastPartByType(parts: Part[], type: string): Part | undefined {
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i]?.type === type) return parts[i];
  }
  return undefined;
}

function getToolParts(parts: Part[]): Part[] {
  return parts.filter(p => p.type === "tool");
}

function getReasoningParts(parts: Part[]): Part[] {
  return parts.filter(p => p.type === "reasoning");
}

function getPermissionParts(parts: Part[]): Part[] {
  return parts.filter(p => p.type === "permission");
}

function getQuestionParts(parts: Part[]): Part[] {
  return parts.filter(p => p.type === "question");
}

function getPartTimestamp(part: Part): number {
  const readTime = (value: unknown): number | undefined => {
    if (!value || typeof value !== "object") return undefined;
    const start = (value as { start?: unknown }).start;
    if (typeof start === "number") return start;
    const created = (value as { created?: unknown }).created;
    if (typeof created === "number") return created;
    const end = (value as { end?: unknown }).end;
    if (typeof end === "number") return end;
    return undefined;
  };

  const topLevel = readTime((part as { time?: unknown }).time);
  if (typeof topLevel === "number") return topLevel;

  const stateTime = readTime((part as { state?: { time?: unknown } }).state?.time);
  if (typeof stateTime === "number") return stateTime;

  return Number.POSITIVE_INFINITY;
}

function getPartEventSequence(part: Part): number | undefined {
  const metadata = (part as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== "object") return undefined;
  const sequence = (metadata as { __eventSequence?: unknown }).__eventSequence;
  return typeof sequence === "number" ? sequence : undefined;
}

function getPromptDedupKey(part: Part): string {
  const fallbackId = part.id ?? "";
  if (part.type === "permission") {
    const partId = (part as { permissionId?: unknown }).permissionId;
    const requestId = (part as { request?: { id?: unknown } }).request?.id;
    if (typeof partId === "string" && partId.length > 0) return `permission:${partId}`;
    if (typeof requestId === "string" && requestId.length > 0) return `permission:${requestId}`;
    return `permission:${fallbackId}`;
  }
  if (part.type === "question") {
    const partId = (part as { questionId?: unknown }).questionId;
    const requestId = (part as { request?: { id?: unknown } }).request?.id;
    if (typeof partId === "string" && partId.length > 0) return `question:${partId}`;
    if (typeof requestId === "string" && requestId.length > 0) return `question:${requestId}`;
    return `question:${fallbackId}`;
  }
  return fallbackId;
}

const ORDERED_PARTS_CACHE_MAX = 512;
const orderedPartsCache = new Map<string, Part[]>();

function readPartTextLength(part: Part): number {
  const text = (part as { text?: unknown }).text;
  return typeof text === "string" ? text.length : 0;
}

function readPartStatus(part: Part): string {
  const state = (part as { state?: { status?: unknown } }).state;
  return typeof state?.status === "string" ? state.status : "";
}

function buildPartSignature(part: Part): string {
  const seq = getPartEventSequence(part) ?? -1;
  const ts = getPartTimestamp(part);
  return [
    part.id ?? "",
    part.type ?? "",
    part.messageID ?? "",
    seq,
    Number.isFinite(ts) ? ts : -1,
    readPartStatus(part),
    readPartTextLength(part),
    getPromptDedupKey(part),
  ].join("|");
}

function buildOrderedPartsCacheKey(
  assistantMessages: MessageWithId[],
  assistantPartsByMessageId: Record<string, Part[]>,
  permissionParts: Part[],
  questionParts: Part[]
): string {
  const messageSig = assistantMessages.map(message => message.id).join(",");
  const partSig = assistantMessages
    .map(message => (assistantPartsByMessageId[message.id] ?? []).map(buildPartSignature).join(";"))
    .join("||");
  const permissionSig = permissionParts.map(buildPartSignature).join(";");
  const questionSig = questionParts.map(buildPartSignature).join(";");
  return `${messageSig}#${partSig}#${permissionSig}#${questionSig}`;
}

function getCachedOrderedParts(cacheKey: string): Part[] | undefined {
  const cached = orderedPartsCache.get(cacheKey);
  if (!cached) return undefined;

  // LRU touch
  orderedPartsCache.delete(cacheKey);
  orderedPartsCache.set(cacheKey, cached);
  return cached;
}

function setCachedOrderedParts(cacheKey: string, parts: Part[]): void {
  if (orderedPartsCache.size >= ORDERED_PARTS_CACHE_MAX) {
    const oldestKey = orderedPartsCache.keys().next().value;
    if (typeof oldestKey === "string") {
      orderedPartsCache.delete(oldestKey);
    }
  }
  orderedPartsCache.set(cacheKey, parts);
}

function buildOrderedParts(
  assistantMessages: MessageWithId[],
  assistantPartsByMessageId: Record<string, Part[]>,
  permissionParts: Part[],
  questionParts: Part[]
): Part[] {
  const cacheKey = buildOrderedPartsCacheKey(
    assistantMessages,
    assistantPartsByMessageId,
    permissionParts,
    questionParts
  );
  const cached = getCachedOrderedParts(cacheKey);
  if (cached) return cached;

  const messageOrder = new Map<string, number>();
  for (let index = 0; index < assistantMessages.length; index++) {
    messageOrder.set(assistantMessages[index].id, index);
  }

  const partOrderByMessage = new Map<string, Map<string, number>>();
  for (const message of assistantMessages) {
    const parts = assistantPartsByMessageId[message.id] ?? [];
    const order = new Map<string, number>();
    for (let index = 0; index < parts.length; index++) {
      order.set(parts[index].id ?? "", index);
    }
    partOrderByMessage.set(message.id, order);
  }

  const merged: Part[] = [];
  for (const message of assistantMessages) {
    merged.push(...(assistantPartsByMessageId[message.id] ?? []));
  }

  const seenPromptKeys = new Set<string>();
  for (const part of merged) {
    if (part.type === "permission" || part.type === "question") {
      seenPromptKeys.add(getPromptDedupKey(part));
    }
  }

  for (const part of [...permissionParts, ...questionParts]) {
    const key = getPromptDedupKey(part);
    if (seenPromptKeys.has(key)) continue;
    merged.push(part);
    seenPromptKeys.add(key);
  }

  const sorted = merged.sort((a, b) => {
    const aSeq = getPartEventSequence(a);
    const bSeq = getPartEventSequence(b);
    if (typeof aSeq === "number" && typeof bSeq === "number" && aSeq !== bSeq) {
      return aSeq - bSeq;
    }

    const timestampDelta = getPartTimestamp(a) - getPartTimestamp(b);
    if (timestampDelta !== 0) return timestampDelta;

    const aMessageId = a.messageID ?? "";
    const bMessageId = b.messageID ?? "";
    const aPartId = a.id ?? "";
    const bPartId = b.id ?? "";

    const messageDelta =
      (messageOrder.get(aMessageId) ?? Number.POSITIVE_INFINITY) -
      (messageOrder.get(bMessageId) ?? Number.POSITIVE_INFINITY);
    if (messageDelta !== 0) return messageDelta;

    const aOrder = partOrderByMessage.get(aMessageId)?.get(aPartId) ?? Number.POSITIVE_INFINITY;
    const bOrder = partOrderByMessage.get(bMessageId)?.get(bPartId) ?? Number.POSITIVE_INFINITY;
    if (aOrder !== bOrder) return aOrder - bOrder;

    return aPartId.localeCompare(bPartId);
  });

  setCachedOrderedParts(cacheKey, sorted);
  return sorted;
}

export function buildChatTurns(options: TurnProjectionOptions): ChatTurn[] {
  const {
    messages,
    partsByMessage,
    permissionRequests = [],
    questionRequests = [],
    sessionStatus,
    lastUserMessageId,
  } = options;

  if (messages.length === 0) return [];

  const turns: ChatTurn[] = [];
  const userMessages = messages.filter(m => m.role === "user");

  for (const userMessage of userMessages) {
    const userParts = partsByMessage[userMessage.id] ?? [];
    const isActiveTurn = userMessage.id === lastUserMessageId;
    let working = isActiveTurn && sessionStatus?.type !== "idle";
    const retry =
      isActiveTurn && sessionStatus?.type === "retry"
        ? {
            attempt: sessionStatus.attempt,
            message: sessionStatus.message,
            next: sessionStatus.next,
          }
        : undefined;

    const assistantMessages: MessageWithId[] = [];
    const assistantPartsByMessageId: Record<string, Part[]> = {};
    const allAssistantParts: Part[] = [];

    const userIndex = messages.findIndex(m => m.id === userMessage.id);
    for (let i = userIndex + 1; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role === "user") break;
      if (msg.role === "assistant" && msg.parentID === userMessage.id) {
        assistantMessages.push(msg);
        const parts = partsByMessage[msg.id] ?? [];
        assistantPartsByMessageId[msg.id] = parts;
        allAssistantParts.push(...parts);
      }
    }

    const finalTextPart = findLastPartByType(allAssistantParts, "text");
    const reasoningParts = getReasoningParts(allAssistantParts);
    const toolParts = getToolParts(allAssistantParts);
    const partPermissionParts = getPermissionParts(allAssistantParts);
    const partQuestionParts = getQuestionParts(allAssistantParts);
    const assistantMessageIds = new Set(assistantMessages.map(message => message.id));

    const storePermissionParts = permissionRequests
      .filter(request => assistantMessageIds.has(request.messageID))
      .map(
        request =>
          ({
            id: `permission:${request.id}`,
            type: "permission",
            messageID: request.messageID,
            time: { start: request.timestamp, end: request.timestamp },
            request,
          }) as Part
      );

    const storeQuestionParts = questionRequests
      .filter(request => assistantMessageIds.has(request.messageID))
      .map(
        request =>
          ({
            id: `question:${request.id}`,
            type: "question",
            messageID: request.messageID,
            time: { start: request.timestamp, end: request.timestamp },
            request,
          }) as Part
      );

    const permissionParts = [...partPermissionParts];
    for (const storePart of storePermissionParts) {
      if (!permissionParts.some(part => part.id === storePart.id)) {
        permissionParts.push(storePart);
      }
    }

    const questionParts = [...partQuestionParts];
    for (const storePart of storeQuestionParts) {
      if (!questionParts.some(part => part.id === storePart.id)) {
        questionParts.push(storePart);
      }
    }

    const orderedParts = buildOrderedParts(
      assistantMessages,
      assistantPartsByMessageId,
      permissionParts,
      questionParts
    );

    const lastAssistantMessage = assistantMessages[assistantMessages.length - 1];
    const error = lastAssistantMessage ? getErrorMessage(lastAssistantMessage) : undefined;

    const userCreated = getTimeField(userMessage, "created");
    const assistantCompleted = lastAssistantMessage
      ? getTimeField(lastAssistantMessage, "completed")
      : undefined;
    const durationMs = computeDuration(userCreated, assistantCompleted);

    const pendingPermission = permissionRequests.some(
      request => assistantMessageIds.has(request.messageID) && request.status === "pending"
    );
    const pendingQuestion = questionRequests.some(
      request => assistantMessageIds.has(request.messageID) && request.status === "pending"
    );
    // Defensive fallback: if assistant response already completed and there is no
    // pending human input, the turn should not remain "working" even if a status
    // update was delayed/missed.
    if (
      working &&
      assistantCompleted !== undefined &&
      !pendingPermission &&
      !pendingQuestion &&
      retry === undefined
    ) {
      working = false;
    }
    const lastMeaningfulPart = orderedParts.at(-1);
    const statusLabel = working ? deriveStatusFromPart(lastMeaningfulPart) : undefined;

    turns.push({
      userMessage,
      userParts,
      assistantMessages,
      assistantPartsByMessageId,
      finalTextPart,
      reasoningParts,
      toolParts,
      permissionParts,
      questionParts,
      orderedParts,
      isActiveTurn,
      working,
      retry,
      error,
      durationMs,
      statusLabel:
        working && (pendingPermission || pendingQuestion) ? "Waiting for input" : statusLabel,
    });
  }

  turns.sort((a, b) => {
    const aCreated = getTimeField(a.userMessage, "created") ?? 0;
    const bCreated = getTimeField(b.userMessage, "created") ?? 0;
    return aCreated - bCreated;
  });

  return turns;
}
