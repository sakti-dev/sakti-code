/**
 * Turn Fixtures for Testing
 *
 * Provides test data and utilities for turn projection testing.
 * Based on existing patterns in data-integrity.ts
 */

import type { MessageWithId } from "@/core/state/stores/message-store";
import type { PermissionRequest } from "@/core/state/stores/permission-store";
import type { QuestionRequest } from "@/core/state/stores/question-store";
import type { Part, SessionStatusPayload } from "@ekacode/shared/event-types";
import { v7 as uuidv7 } from "uuid";
import {
  createPendingPermissionRequest,
  createPendingQuestionRequest,
} from "./permission-question-fixtures";

export interface TurnProjectionOptions {
  sessionId: string;
  messages: MessageWithId[];
  partsByMessage: Record<string, Part[]>;
  permissionRequests?: PermissionRequest[];
  questionRequests?: QuestionRequest[];
  sessionStatus: SessionStatusPayload["status"];
  lastUserMessageId: string | undefined;
}

export function createSampleUserMessage(
  sessionId: string,
  messageId?: string,
  text = "Hello, can you help me?"
): { message: MessageWithId; parts: Part[] } {
  const id = messageId || uuidv7();
  const created = Date.now();
  const message: MessageWithId = {
    id,
    role: "user",
    sessionID: sessionId,
    time: { created },
  };

  const parts: Part[] = [
    {
      id: `${id}-part-1`,
      type: "text",
      messageID: id,
      sessionID: sessionId,
      text,
      time: { start: created, end: created },
    },
  ];

  return { message, parts };
}

export function createSampleAssistantMessage(
  sessionId: string,
  parentId: string,
  messageId?: string,
  options?: {
    text?: string;
    reasoning?: string;
    tools?: { name: string; status: string }[];
    error?: string;
    completed?: boolean;
  }
): { message: MessageWithId; parts: Part[] } {
  const id = messageId || uuidv7();
  const created = Date.now();
  const completed = options?.completed ? created + 5000 : undefined;

  const message: MessageWithId = {
    id,
    role: "assistant",
    parentID: parentId,
    sessionID: sessionId,
    time: { created, completed },
    ...(options?.error ? { error: { message: options.error } } : {}),
  };

  const parts: Part[] = [];
  let partIndex = 0;

  if (options?.reasoning) {
    parts.push({
      id: `${id}-part-${partIndex++}`,
      type: "reasoning",
      messageID: id,
      sessionID: sessionId,
      text: options.reasoning,
      time: { start: created, end: created + 100 },
    });
  }

  if (options?.tools) {
    for (const tool of options.tools) {
      parts.push({
        id: `${id}-part-${partIndex++}`,
        type: "tool",
        messageID: id,
        sessionID: sessionId,
        tool: tool.name,
        state: { status: tool.status },
        time: { start: created + partIndex * 100, end: created + partIndex * 100 + 50 },
      } as Part);
    }
  }

  if (options?.text) {
    parts.push({
      id: `${id}-part-${partIndex++}`,
      type: "text",
      messageID: id,
      sessionID: sessionId,
      text: options.text,
      time: { start: created + partIndex * 100, end: completed || created + partIndex * 100 + 50 },
    });
  }

  return { message, parts };
}

export function createSingleTurnFixture(
  sessionId?: string
): TurnProjectionOptions & { expectedUserMessageId: string; expectedAssistantMessageId: string } {
  const sid = sessionId || uuidv7();
  const user = createSampleUserMessage(sid);
  const assistant = createSampleAssistantMessage(sid, user.message.id, undefined, {
    text: "I'd be happy to help! What would you like to know?",
    completed: true,
  });

  const messages = [user.message, assistant.message];
  const partsByMessage: Record<string, Part[]> = {
    [user.message.id]: user.parts,
    [assistant.message.id]: assistant.parts,
  };

  return {
    sessionId: sid,
    messages,
    partsByMessage,
    sessionStatus: { type: "idle" },
    lastUserMessageId: user.message.id,
    expectedUserMessageId: user.message.id,
    expectedAssistantMessageId: assistant.message.id,
  };
}

export function createMultiTurnFixture(sessionId?: string, turnCount = 2): TurnProjectionOptions {
  const sid = sessionId || uuidv7();
  const messages: MessageWithId[] = [];
  const partsByMessage: Record<string, Part[]> = {};
  let lastUserId: string | undefined;

  for (let i = 0; i < turnCount; i++) {
    const user = createSampleUserMessage(sid, undefined, `User message ${i + 1}`);
    const assistant = createSampleAssistantMessage(sid, user.message.id, undefined, {
      text: `Assistant response ${i + 1}`,
      reasoning: i === 0 ? "Let me think about this..." : undefined,
      tools: i === 1 ? [{ name: "read", status: "completed" }] : undefined,
      completed: true,
    });

    messages.push(user.message, assistant.message);
    partsByMessage[user.message.id] = user.parts;
    partsByMessage[assistant.message.id] = assistant.parts;
    lastUserId = user.message.id;
  }

  return {
    sessionId: sid,
    messages,
    partsByMessage,
    sessionStatus: { type: "idle" },
    lastUserMessageId: lastUserId,
  };
}

export function createStreamingTurnFixture(sessionId?: string): TurnProjectionOptions {
  const sid = sessionId || uuidv7();
  const user = createSampleUserMessage(sid);
  const assistant = createSampleAssistantMessage(sid, user.message.id, undefined, {
    reasoning: "Thinking...",
    tools: [{ name: "read", status: "running" }],
    text: "I'm working on", // Streaming, not complete
    completed: false,
  });

  const messages = [user.message, assistant.message];
  const partsByMessage: Record<string, Part[]> = {
    [user.message.id]: user.parts,
    [assistant.message.id]: assistant.parts,
  };

  return {
    sessionId: sid,
    messages,
    partsByMessage,
    sessionStatus: { type: "busy" },
    lastUserMessageId: user.message.id,
  };
}

export function createErrorTurnFixture(sessionId?: string): TurnProjectionOptions {
  const sid = sessionId || uuidv7();
  const user = createSampleUserMessage(sid);
  const assistant = createSampleAssistantMessage(sid, user.message.id, undefined, {
    error: "Something went wrong",
    completed: true,
  });

  const messages = [user.message, assistant.message];
  const partsByMessage: Record<string, Part[]> = {
    [user.message.id]: user.parts,
    [assistant.message.id]: assistant.parts,
  };

  return {
    sessionId: sid,
    messages,
    partsByMessage,
    sessionStatus: { type: "idle" },
    lastUserMessageId: user.message.id,
  };
}

export function createEmptySessionFixture(sessionId?: string): TurnProjectionOptions {
  const sid = sessionId || uuidv7();
  return {
    sessionId: sid,
    messages: [],
    partsByMessage: {},
    sessionStatus: { type: "idle" },
    lastUserMessageId: undefined,
  };
}

export function createUserOnlyFixture(sessionId?: string): TurnProjectionOptions {
  const sid = sessionId || uuidv7();
  const user = createSampleUserMessage(sid);

  return {
    sessionId: sid,
    messages: [user.message],
    partsByMessage: { [user.message.id]: user.parts },
    sessionStatus: { type: "busy" }, // Waiting for assistant
    lastUserMessageId: user.message.id,
  };
}

export function createSingleTurnWithPromptsFixture(sessionId?: string): TurnProjectionOptions & {
  expectedUserMessageId: string;
  expectedAssistantMessageId: string;
  permission: PermissionRequest;
  question: QuestionRequest;
} {
  const base = createSingleTurnFixture(sessionId);
  const permission = createPendingPermissionRequest({
    id: "perm-1",
    sessionID: base.sessionId,
    messageID: base.expectedAssistantMessageId,
    toolName: "bash",
    args: { command: "npm run build" },
  });
  const question = createPendingQuestionRequest({
    id: "question-1",
    sessionID: base.sessionId,
    messageID: base.expectedAssistantMessageId,
    question: "Use strict mode?",
    options: ["yes", "no"],
  });

  return {
    ...base,
    permissionRequests: [permission],
    questionRequests: [question],
    permission,
    question,
  };
}
