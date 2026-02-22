/**
 * Turn Fixtures for Testing
 *
 * Provides test data and utilities for turn projection testing.
 * Based on existing patterns in data-integrity.ts
 */

import type { MessageWithId } from "@/core/state/stores/message-store";
import type { PermissionRequest } from "@/core/state/stores/permission-store";
import type { QuestionRequest } from "@/core/state/stores/question-store";
import type { Part, SessionStatusPayload } from "@sakti-code/shared/event-types";
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

export function createInterleavedAssistantPartsFixture(
  sessionId?: string
): TurnProjectionOptions & {
  expectedOrderIds: string[];
  expectedUserMessageId: string;
  expectedAssistantMessageId: string;
} {
  const sid = sessionId || uuidv7();
  const baseTime = Date.now();

  const userMessageId = uuidv7();
  const assistantMessageId = uuidv7();

  const userMessage: MessageWithId = {
    id: userMessageId,
    role: "user",
    sessionID: sid,
    time: { created: baseTime },
  };

  const assistantMessage: MessageWithId = {
    id: assistantMessageId,
    role: "assistant",
    parentID: userMessageId,
    sessionID: sid,
    time: { created: baseTime + 50, completed: baseTime + 1_000 },
  };

  const userParts: Part[] = [
    {
      id: `${userMessageId}-text`,
      type: "text",
      messageID: userMessageId,
      sessionID: sid,
      text: "Please inspect the repository",
      time: { start: baseTime, end: baseTime + 1 },
    },
  ];

  const assistantParts: Part[] = [
    {
      id: "a-text-1",
      type: "text",
      messageID: assistantMessageId,
      sessionID: sid,
      text: "I will inspect the project first.",
      time: { start: baseTime + 100, end: baseTime + 110 },
    },
    {
      id: "a-tool-1",
      type: "tool",
      messageID: assistantMessageId,
      sessionID: sid,
      tool: "read",
      state: { status: "completed" },
      time: { start: baseTime + 200, end: baseTime + 220 },
    } as Part,
    {
      id: "a-reasoning-1",
      type: "reasoning",
      messageID: assistantMessageId,
      sessionID: sid,
      text: "The read result suggests checking related files.",
      time: { start: baseTime + 300, end: baseTime + 320 },
    },
    {
      id: "a-tool-2",
      type: "tool",
      messageID: assistantMessageId,
      sessionID: sid,
      tool: "grep",
      state: { status: "completed" },
      time: { start: baseTime + 400, end: baseTime + 420 },
    } as Part,
    {
      id: "a-reasoning-2",
      type: "reasoning",
      messageID: assistantMessageId,
      sessionID: sid,
      text: "Now I can summarize the findings.",
      time: { start: baseTime + 700, end: baseTime + 720 },
    },
    {
      id: "a-text-2",
      type: "text",
      messageID: assistantMessageId,
      sessionID: sid,
      text: "Summary: here is what I found.",
      time: { start: baseTime + 900, end: baseTime + 930 },
    },
  ];

  const permission = createPendingPermissionRequest({
    id: "perm-interleaved",
    sessionID: sid,
    messageID: assistantMessageId,
    toolName: "bash",
    args: { command: "pnpm test" },
    timestamp: baseTime + 500,
  });

  const question = createPendingQuestionRequest({
    id: "question-interleaved",
    sessionID: sid,
    messageID: assistantMessageId,
    question: "Run full suite?",
    options: ["yes", "no"],
    timestamp: baseTime + 800,
  });

  return {
    sessionId: sid,
    messages: [userMessage, assistantMessage],
    partsByMessage: {
      [userMessageId]: userParts,
      [assistantMessageId]: assistantParts,
    },
    permissionRequests: [permission],
    questionRequests: [question],
    sessionStatus: { type: "busy" },
    lastUserMessageId: userMessageId,
    expectedOrderIds: [
      "a-text-1",
      "a-tool-1",
      "a-reasoning-1",
      "a-tool-2",
      "permission:perm-interleaved",
      "a-reasoning-2",
      "question:question-interleaved",
      "a-text-2",
    ],
    expectedUserMessageId: userMessageId,
    expectedAssistantMessageId: assistantMessageId,
  };
}

export function createSequenceOrderedPartsFixture(
  sessionId?: string
): TurnProjectionOptions & { expectedOrderIds: string[] } {
  const sid = sessionId || uuidv7();
  const baseTime = Date.now();
  const userId = uuidv7();
  const assistantId = uuidv7();

  const messages: MessageWithId[] = [
    {
      id: userId,
      role: "user",
      sessionID: sid,
      time: { created: baseTime },
    },
    {
      id: assistantId,
      role: "assistant",
      parentID: userId,
      sessionID: sid,
      time: { created: baseTime + 10, completed: baseTime + 1000 },
    },
  ];

  const partsByMessage: Record<string, Part[]> = {
    [userId]: [
      {
        id: `${userId}-text`,
        type: "text",
        messageID: userId,
        sessionID: sid,
        text: "Tell me about the repo",
      },
    ],
    [assistantId]: [
      {
        id: "part-summary",
        type: "text",
        messageID: assistantId,
        sessionID: sid,
        text: "Final summary",
        metadata: { __eventSequence: 120 },
      } as Part,
      {
        id: "part-tool-1",
        type: "tool",
        messageID: assistantId,
        sessionID: sid,
        tool: "ls",
        state: { status: "completed", time: { start: baseTime + 100, end: baseTime + 200 } },
        metadata: { __eventSequence: 105 },
      } as Part,
      {
        id: "part-reasoning",
        type: "reasoning",
        messageID: assistantId,
        sessionID: sid,
        text: "Let me inspect files first",
        metadata: { __eventSequence: 110 },
      } as Part,
    ],
  };

  return {
    sessionId: sid,
    messages,
    partsByMessage,
    sessionStatus: { type: "idle" },
    lastUserMessageId: userId,
    expectedOrderIds: ["part-tool-1", "part-reasoning", "part-summary"],
  };
}

export function createInterleavedAssistantPartsWithRetryFixture(
  sessionId?: string
): TurnProjectionOptions & {
  expectedOrderIds: string[];
  expectedUserMessageId: string;
  expectedAssistantMessageId: string;
} {
  const base = createInterleavedAssistantPartsFixture(sessionId);
  const parts = base.partsByMessage[base.expectedAssistantMessageId] ?? [];
  const retryPart: Part = {
    id: "a-retry-1",
    type: "retry",
    messageID: base.expectedAssistantMessageId,
    sessionID: base.sessionId,
    attempt: 1,
    next: Date.now() + 3_000,
    error: {
      message: "Cannot connect to API: other side closed",
      isRetryable: true,
      metadata: { kind: "socket_closed" },
    },
    time: { created: Date.now() + 600, start: Date.now() + 600, end: Date.now() + 600 },
  };

  const retryIndex = parts.findIndex(part => part.id === "a-reasoning-2");
  if (retryIndex >= 0) {
    parts.splice(retryIndex, 0, retryPart);
  } else {
    parts.push(retryPart);
  }

  return {
    ...base,
    partsByMessage: {
      ...base.partsByMessage,
      [base.expectedAssistantMessageId]: parts,
    },
    expectedOrderIds: [
      "a-text-1",
      "a-tool-1",
      "a-reasoning-1",
      "a-tool-2",
      "permission:perm-interleaved",
      "a-retry-1",
      "a-reasoning-2",
      "question:question-interleaved",
      "a-text-2",
    ],
  };
}
