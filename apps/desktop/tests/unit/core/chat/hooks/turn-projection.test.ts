/**
 * Turn Projection Tests
 *
 * Tests for the pure projection functions that build ChatTurn model
 * from normalized stores.
 */

import {
  buildChatTurns,
  computeDuration,
  deriveStatusFromPart,
} from "@/core/chat/hooks/turn-projection";
import type { Part } from "@sakti-code/shared/event-types";
import { describe, expect, it } from "vitest";
import {
  createEmptySessionFixture,
  createErrorTurnFixture,
  createInterleavedAssistantPartsFixture,
  createInterleavedAssistantPartsWithRetryFixture,
  createMultiTurnFixture,
  createSequenceOrderedPartsFixture,
  createSingleTurnFixture,
  createSingleTurnWithPromptsFixture,
  createStreamingTurnFixture,
  createUserOnlyFixture,
} from "../../../../fixtures/turn-fixtures";

describe("turn-projection", () => {
  describe("buildChatTurns", () => {
    it("returns empty array for empty session", () => {
      const fixture = createEmptySessionFixture();
      const turns = buildChatTurns(fixture);

      expect(turns).toEqual([]);
    });

    it("groups assistant messages by user parentID", () => {
      const fixture = createSingleTurnFixture();
      const turns = buildChatTurns(fixture);

      expect(turns).toHaveLength(1);
      expect(turns[0].userMessage.id).toBe(fixture.expectedUserMessageId);
      expect(turns[0].assistantMessages).toHaveLength(1);
      expect(turns[0].assistantMessages[0].id).toBe(fixture.expectedAssistantMessageId);
    });

    it("extracts final text part as summary", () => {
      const fixture = createSingleTurnFixture();
      const turns = buildChatTurns(fixture);

      expect(turns[0].finalTextPart).toBeDefined();
      expect(turns[0].finalTextPart?.type).toBe("text");
      expect(typeof turns[0].finalTextPart?.text).toBe("string");
    });

    it("collects tool and reasoning parts as steps", () => {
      const fixture = createMultiTurnFixture(undefined, 2);
      const turns = buildChatTurns(fixture);

      // Second turn has reasoning and tool
      const turnWithSteps = turns.find(t => t.reasoningParts.length > 0 || t.toolParts.length > 0);
      expect(turnWithSteps).toBeDefined();
    });

    it("builds orderedParts in strict chronological order for interleaved assistant events", () => {
      const fixture = createInterleavedAssistantPartsFixture();
      const turns = buildChatTurns(fixture);

      expect(turns).toHaveLength(1);
      expect(turns[0].orderedParts.map(part => part.id)).toEqual(fixture.expectedOrderIds);
    });

    it("orders retry parts chronologically using retry next-aware fixture", () => {
      const fixture = createInterleavedAssistantPartsWithRetryFixture();
      const turns = buildChatTurns(fixture);

      expect(turns).toHaveLength(1);
      expect(turns[0].orderedParts.map(part => part.id)).toEqual(fixture.expectedOrderIds);

      const retryPart = turns[0].orderedParts.find(part => part.type === "retry");
      expect(retryPart).toBeDefined();
      expect(retryPart?.next).toBeTypeOf("number");
    });

    it("reuses orderedParts array reference for identical turn inputs", () => {
      const fixture = createInterleavedAssistantPartsFixture();
      const first = buildChatTurns(fixture);
      const second = buildChatTurns(fixture);

      expect(first).toHaveLength(1);
      expect(second).toHaveLength(1);
      expect(second[0].orderedParts).toBe(first[0].orderedParts);
    });

    it("invalidates orderedParts cache when part content changes", () => {
      const fixture = createInterleavedAssistantPartsFixture();
      const first = buildChatTurns(fixture);
      const assistantId = fixture.expectedAssistantMessageId;
      const mutablePart = fixture.partsByMessage[assistantId]?.find(
        part => part.type === "text" && typeof part.text === "string"
      ) as Part | undefined;
      if (!mutablePart || typeof mutablePart.text !== "string") {
        throw new Error("Expected text part in interleaved fixture");
      }
      mutablePart.text = `${mutablePart.text} updated`;

      const second = buildChatTurns(fixture);
      expect(second[0].orderedParts).not.toBe(first[0].orderedParts);
    });

    it("prefers event sequence ordering when metadata sequence exists", () => {
      const fixture = createSequenceOrderedPartsFixture();
      const turns = buildChatTurns(fixture);

      expect(turns).toHaveLength(1);
      expect(turns[0].orderedParts.map(part => part.id)).toEqual(fixture.expectedOrderIds);
    });

    it("derives status label from the latest meaningful ordered part", () => {
      const fixture = createInterleavedAssistantPartsFixture();
      const turns = buildChatTurns(fixture);

      expect(turns).toHaveLength(1);
      expect(turns[0].statusLabel).toBe("Waiting for input");
    });

    it("deduplicates synthetic permission/question parts when canonical part already exists", () => {
      const fixture = createInterleavedAssistantPartsFixture();
      const assistantId = fixture.expectedAssistantMessageId;
      const assistantParts = fixture.partsByMessage[assistantId] ?? [];

      assistantParts.push(
        {
          id: "permission:perm-interleaved",
          type: "permission",
          messageID: assistantId,
          request: fixture.permissionRequests?.[0],
          time: { start: fixture.permissionRequests?.[0]?.timestamp ?? Date.now() },
        } as Part,
        {
          id: "question:question-interleaved",
          type: "question",
          messageID: assistantId,
          request: fixture.questionRequests?.[0],
          time: { start: fixture.questionRequests?.[0]?.timestamp ?? Date.now() },
        } as Part
      );

      const turns = buildChatTurns(fixture);
      const ids = turns[0].orderedParts.map(part => part.id);

      expect(ids.filter(id => id === "permission:perm-interleaved")).toHaveLength(1);
      expect(ids.filter(id => id === "question:question-interleaved")).toHaveLength(1);
    });

    it("projects permission/question requests into turn steps", () => {
      const fixture = createSingleTurnWithPromptsFixture();

      const turns = buildChatTurns(fixture);

      expect(turns[0].permissionParts).toHaveLength(1);
      expect(turns[0].questionParts).toHaveLength(1);
    });

    it("marks active turn when user message is latest", () => {
      const fixture = createSingleTurnFixture();
      const turns = buildChatTurns(fixture);

      expect(turns[0].isActiveTurn).toBe(true);
    });

    it("marks non-active turn when not latest", () => {
      const fixture = createMultiTurnFixture(undefined, 2);
      const turns = buildChatTurns(fixture);

      // First turn should not be active
      expect(turns[0].isActiveTurn).toBe(false);
      // Last turn should be active
      expect(turns[1].isActiveTurn).toBe(true);
    });

    it("derives working from session status + active turn", () => {
      const streamingFixture = createStreamingTurnFixture();
      const streamingTurns = buildChatTurns(streamingFixture);

      expect(streamingTurns[0].working).toBe(true);

      const idleFixture = createSingleTurnFixture();
      const idleTurns = buildChatTurns(idleFixture);

      expect(idleTurns[0].working).toBe(false);
    });

    it("does not keep working when assistant already completed and no pending prompts", () => {
      const fixture = createStreamingTurnFixture();
      fixture.permissionRequests = [];
      fixture.questionRequests = [];
      fixture.sessionStatus = { type: "busy" };

      const assistantMessage = fixture.messages.find(message => message.role === "assistant");
      if (!assistantMessage) {
        throw new Error("Expected assistant message in streaming fixture");
      }

      const created =
        assistantMessage.time && typeof assistantMessage.time === "object"
          ? ((assistantMessage.time as { created?: number }).created ?? Date.now())
          : Date.now();

      assistantMessage.time = {
        ...(assistantMessage.time ?? {}),
        created,
        completed: created + 1_000,
      };

      const turns = buildChatTurns(fixture);
      expect(turns[0].working).toBe(false);
    });

    it("projects retry metadata from session status", () => {
      const fixture = createStreamingTurnFixture();
      fixture.sessionStatus = {
        type: "retry",
        attempt: 2,
        message: "rate limited",
        next: Date.now() + 5000,
      };

      const turns = buildChatTurns(fixture);
      expect(turns[0].working).toBe(true);
      expect(turns[0].retry).toBeDefined();
      expect(turns[0].retry?.attempt).toBe(2);
      expect(turns[0].retry?.message).toBe("rate limited");
    });

    it("computes duration from created to completed/now", () => {
      const fixture = createSingleTurnFixture();
      const turns = buildChatTurns(fixture);

      expect(turns[0].durationMs).toBeGreaterThanOrEqual(0);
    });

    it("handles single user message with no assistant", () => {
      const fixture = createUserOnlyFixture();
      const turns = buildChatTurns(fixture);

      expect(turns).toHaveLength(1);
      expect(turns[0].userMessage).toBeDefined();
      expect(turns[0].assistantMessages).toHaveLength(0);
      expect(turns[0].working).toBe(true); // Active turn with busy session
    });

    it("extracts error from assistant message", () => {
      const fixture = createErrorTurnFixture();
      const turns = buildChatTurns(fixture);

      expect(turns[0].error).toBeDefined();
    });

    it("preserves user parts", () => {
      const fixture = createSingleTurnFixture();
      const turns = buildChatTurns(fixture);

      expect(turns[0].userParts).toHaveLength(1);
      expect(turns[0].userParts[0].type).toBe("text");
    });

    it("orders turns chronologically by user message creation", () => {
      const fixture = createMultiTurnFixture(undefined, 3);
      const turns = buildChatTurns(fixture);

      for (let i = 1; i < turns.length; i++) {
        const prevTime = turns[i - 1].userMessage.time;
        const currTime = turns[i].userMessage.time;
        const prevCreated =
          prevTime && typeof prevTime === "object" && "created" in prevTime
            ? (prevTime as { created: number }).created
            : 0;
        const currCreated =
          currTime && typeof currTime === "object" && "created" in currTime
            ? (currTime as { created: number }).created
            : 0;
        expect(currCreated).toBeGreaterThanOrEqual(prevCreated);
      }
    });
  });

  describe("deriveStatusFromPart", () => {
    it('returns "Thinking" for reasoning parts', () => {
      const part = { type: "reasoning", text: "Let me think..." } as Part;
      expect(deriveStatusFromPart(part)).toBe("Thinking");
    });

    it('returns "Gathering context" for read tool', () => {
      const part = { type: "tool", tool: "read" } as Part;
      expect(deriveStatusFromPart(part)).toBe("Gathering context");
    });

    it('returns "Searching codebase" for list tool', () => {
      const part = { type: "tool", tool: "list" } as Part;
      expect(deriveStatusFromPart(part)).toBe("Searching codebase");
    });

    it('returns "Searching codebase" for grep tool', () => {
      const part = { type: "tool", tool: "grep" } as Part;
      expect(deriveStatusFromPart(part)).toBe("Searching codebase");
    });

    it('returns "Searching codebase" for glob tool', () => {
      const part = { type: "tool", tool: "glob" } as Part;
      expect(deriveStatusFromPart(part)).toBe("Searching codebase");
    });

    it('returns "Searching codebase" for ls tool', () => {
      const part = { type: "tool", tool: "ls" } as Part;
      expect(deriveStatusFromPart(part)).toBe("Searching codebase");
    });

    it('returns "Searching web" for webfetch tool', () => {
      const part = { type: "tool", tool: "webfetch" } as Part;
      expect(deriveStatusFromPart(part)).toBe("Searching web");
    });

    it('returns "Delegating work" for task tool', () => {
      const part = { type: "tool", tool: "task" } as Part;
      expect(deriveStatusFromPart(part)).toBe("Delegating work");
    });

    it('returns "Planning next steps" for todoread tool', () => {
      const part = { type: "tool", tool: "todoread" } as Part;
      expect(deriveStatusFromPart(part)).toBe("Planning next steps");
    });

    it('returns "Making edits" for edit tool', () => {
      const part = { type: "tool", tool: "edit" } as Part;
      expect(deriveStatusFromPart(part)).toBe("Making edits");
    });

    it('returns "Making edits" for write tool', () => {
      const part = { type: "tool", tool: "write" } as Part;
      expect(deriveStatusFromPart(part)).toBe("Making edits");
    });

    it('returns "Running commands" for bash tool', () => {
      const part = { type: "tool", tool: "bash" } as Part;
      expect(deriveStatusFromPart(part)).toBe("Running commands");
    });

    it('returns "Waiting for input" for question tool', () => {
      const part = { type: "tool", tool: "question" } as Part;
      expect(deriveStatusFromPart(part)).toBe("Waiting for input");
    });

    it('returns "Waiting for input" for permission tool', () => {
      const part = { type: "tool", tool: "permission" } as Part;
      expect(deriveStatusFromPart(part)).toBe("Waiting for input");
    });

    it('returns "Working" for unknown tools', () => {
      const part = { type: "tool", tool: "unknown_tool" } as Part;
      expect(deriveStatusFromPart(part)).toBe("Working");
    });

    it('returns "Gathering thoughts" for text part', () => {
      const part = { type: "text", text: "Hello" } as Part;
      expect(deriveStatusFromPart(part)).toBe("Gathering thoughts");
    });

    it("returns undefined for undefined part", () => {
      expect(deriveStatusFromPart(undefined)).toBeUndefined();
    });
  });

  describe("computeDuration", () => {
    it("returns 0 when no start time", () => {
      expect(computeDuration(undefined, undefined)).toBe(0);
    });

    it("returns elapsed time for ongoing work", () => {
      const start = Date.now() - 5000;
      const duration = computeDuration(start, undefined);

      expect(duration).toBeGreaterThanOrEqual(5000);
      expect(duration).toBeLessThan(10000);
    });

    it("returns exact duration when completed", () => {
      const start = 1000000;
      const end = 1005000;
      const duration = computeDuration(start, end);

      expect(duration).toBe(5000);
    });
  });
});
