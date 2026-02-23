/**
 * Chat Stream Parser Tests
 *
 * TDD tests for chat stream parser using shared fixtures.
 *
 * Batch 3: Stream Processing - WS2 Protocol Ingestion
 */

import { createStreamParser, parseChatStream } from "@/core/chat/services/chat-stream-parser";
import {
  createMockStreamReader,
  errorFinishFixture,
  fixtureToUint8Arrays,
  multiDeltaFixture,
  partialChunkFixture,
  rawProtocolFixture,
  reasoningFixture,
  simpleTextFixture,
  type StreamFixture,
  toolCallFixture,
} from "@sakti-code/shared";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const recordedFixtureCandidates = [
  path.resolve(process.cwd(), "tests/fixtures/recorded/chat-stream.from-log.json"),
  path.resolve(process.cwd(), "apps/desktop/tests/fixtures/recorded/chat-stream.from-log.json"),
];

const recordedFixturePath = recordedFixtureCandidates.find(candidate => existsSync(candidate));

function loadRecordedStreamFixtures(): StreamFixture[] {
  if (!recordedFixturePath || !existsSync(recordedFixturePath)) return [];
  const raw = readFileSync(recordedFixturePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (fixture): fixture is StreamFixture =>
      typeof fixture === "object" &&
      fixture !== null &&
      typeof (fixture as StreamFixture).name === "string" &&
      Array.isArray((fixture as StreamFixture).chunks)
  );
}

const recordedFixtures = loadRecordedStreamFixtures();

describe("chat-stream-parser", () => {
  describe("parseChatStream", () => {
    it("should parse simple text fixture", async () => {
      const onTextDelta = vi.fn();
      const onComplete = vi.fn();
      const reader = createMockStreamReader(simpleTextFixture);

      await parseChatStream(
        reader,
        {
          onTextDelta,
          onComplete,
        },
        { timeoutMs: 5000 }
      );

      expect(onTextDelta).toHaveBeenCalledTimes(3);
      expect(onTextDelta).toHaveBeenNthCalledWith(1, simpleTextFixture.messageId, "Hello");
      expect(onTextDelta).toHaveBeenNthCalledWith(2, simpleTextFixture.messageId, " world");
      expect(onTextDelta).toHaveBeenNthCalledWith(3, simpleTextFixture.messageId, "!");
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledWith("stop");
    });

    it("should parse multiple text deltas", async () => {
      const onTextDelta = vi.fn();
      const onComplete = vi.fn();
      const reader = createMockStreamReader(multiDeltaFixture);

      await parseChatStream(reader, { onTextDelta, onComplete });

      expect(onTextDelta).toHaveBeenCalledTimes(5);
      expect(onTextDelta).toHaveBeenNthCalledWith(1, expect.any(String), "The");
      expect(onTextDelta).toHaveBeenNthCalledWith(2, expect.any(String), " quick");
      expect(onTextDelta).toHaveBeenNthCalledWith(3, expect.any(String), " brown");
      expect(onTextDelta).toHaveBeenNthCalledWith(4, expect.any(String), " fox");
      expect(onTextDelta).toHaveBeenNthCalledWith(5, expect.any(String), " jumps");
      expect(onComplete).toHaveBeenCalledWith("stop");
    });

    it("should parse tool call and result", async () => {
      const onToolCallStart = vi.fn();
      const onToolResult = vi.fn();
      const onTextDelta = vi.fn();
      const reader = createMockStreamReader(toolCallFixture);

      await parseChatStream(reader, {
        onToolCallStart,
        onToolResult,
        onTextDelta,
      });

      expect(onToolCallStart).toHaveBeenCalledWith({
        toolCallId: "call_12345",
        toolName: "read_file",
        args: { path: "/README.md" },
      });
      expect(onToolResult).toHaveBeenCalledWith({
        toolCallId: "call_12345",
        result: { content: "# Project README" },
      });
      expect(onTextDelta).toHaveBeenCalledWith(expect.any(String), "Based on the README");
    });

    it("should parse reasoning events", async () => {
      const onDataPart = vi.fn();
      const reader = createMockStreamReader(reasoningFixture);

      await parseChatStream(reader, { onDataPart });

      expect(onDataPart).toHaveBeenCalledTimes(4);
      expect(onDataPart).toHaveBeenNthCalledWith(
        1,
        "data-thought",
        "reason_001",
        expect.objectContaining({ status: "thinking" }),
        undefined
      );
      expect(onDataPart).toHaveBeenNthCalledWith(
        4,
        "data-thought",
        "reason_001",
        expect.objectContaining({ status: "complete" }),
        undefined
      );
    });

    it("should handle error and finish", async () => {
      const onError = vi.fn();
      const onComplete = vi.fn();
      const reader = createMockStreamReader(errorFinishFixture);

      await parseChatStream(reader, { onError, onComplete });

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
      expect(onError.mock.calls[0][0].message).toBe("Model unavailable");
      expect(onComplete).toHaveBeenCalledWith("error");
    });

    it("should parse raw protocol format", async () => {
      const onTextDelta = vi.fn();
      const onComplete = vi.fn();
      const reader = createMockStreamReader(rawProtocolFixture);

      await parseChatStream(reader, { onTextDelta, onComplete });

      expect(onTextDelta).toHaveBeenCalledTimes(2);
      const firstMessageId = onTextDelta.mock.calls[0][0];
      const secondMessageId = onTextDelta.mock.calls[1][0];
      expect(typeof firstMessageId).toBe("string");
      expect(firstMessageId).not.toBe("");
      expect(secondMessageId).toBe(firstMessageId);
      expect(onTextDelta).toHaveBeenNthCalledWith(1, firstMessageId, "Hello");
      expect(onTextDelta).toHaveBeenNthCalledWith(2, firstMessageId, " world");
      expect(onComplete).toHaveBeenCalledWith("stop");
    });

    const recordedTest = recordedFixtures.length > 0 ? it : it.skip;
    recordedTest("parses recorded stream fixture generated from server logs", async () => {
      const fixture = recordedFixtures[0];
      const reader = createMockStreamReader(fixture);
      const onTextDelta = vi.fn();
      const onDataPart = vi.fn();
      const onComplete = vi.fn();

      await parseChatStream(reader, { onTextDelta, onDataPart, onComplete });

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledWith(expect.any(String));
      expect(onTextDelta.mock.calls.length + onDataPart.mock.calls.length).toBeGreaterThan(0);
    });

    it("should handle partial chunks across boundaries", async () => {
      const onTextDelta = vi.fn();
      const onComplete = vi.fn();
      const reader = createMockStreamReader(partialChunkFixture);

      await parseChatStream(reader, { onTextDelta, onComplete });

      expect(onTextDelta).toHaveBeenCalledTimes(2);
      expect(onTextDelta).toHaveBeenNthCalledWith(1, expect.any(String), "Hello world");
      expect(onTextDelta).toHaveBeenNthCalledWith(2, expect.any(String), "!");
      expect(onComplete).toHaveBeenCalledWith("stop");
    });

    it("should handle timeout", async () => {
      // TODO: Fix timeout handling - reader.cancel() doesn't interrupt pending read()
      const onComplete = vi.fn();
      const onError = vi.fn();

      // Create a slow reader that never finishes
      const slowReader: ReadableStreamDefaultReader<Uint8Array> = {
        read: () =>
          new Promise(resolve => {
            setTimeout(() => {
              resolve({ done: false, value: new Uint8Array([1]) });
            }, 2000);
          }),
        releaseLock: vi.fn(),
        cancel: vi.fn().mockResolvedValue(undefined),
      } as unknown as ReadableStreamDefaultReader<Uint8Array>;

      await parseChatStream(slowReader, { onComplete, onError }, { timeoutMs: 50 });

      expect(onComplete).toHaveBeenCalledWith("timeout");
    });

    it("should handle abort signal", async () => {
      const onComplete = vi.fn();
      const abortController = new AbortController();

      // Abort immediately
      abortController.abort();

      const reader = createMockStreamReader(simpleTextFixture);

      await parseChatStream(reader, { onComplete }, { signal: abortController.signal });

      // Should not complete since aborted
      expect(onComplete).not.toHaveBeenCalled();
    });

    it("should handle malformed JSON gracefully", async () => {
      const onComplete = vi.fn();
      const onError = vi.fn();

      const malformedChunks = [
        new TextEncoder().encode("data: {invalid json}\n\n"),
        new TextEncoder().encode('data: {"type":"finish","finishReason":"stop"}\n\n'),
      ];

      let index = 0;
      const reader: ReadableStreamDefaultReader<Uint8Array> = {
        read: async () => {
          if (index >= malformedChunks.length) {
            return { done: true, value: undefined };
          }
          return { done: false, value: malformedChunks[index++] };
        },
        releaseLock: vi.fn(),
        cancel: vi.fn().mockResolvedValue(undefined),
      } as unknown as ReadableStreamDefaultReader<Uint8Array>;

      await parseChatStream(reader, { onComplete, onError });

      // Should still complete despite malformed data
      expect(onComplete).toHaveBeenCalledWith("stop");
    });
  });

  describe("createStreamParser", () => {
    it("should parse chunks incrementally", () => {
      const onTextDelta = vi.fn();
      const onComplete = vi.fn();
      const parser = createStreamParser({ onTextDelta, onComplete });

      const chunks = fixtureToUint8Arrays(simpleTextFixture);

      for (const chunk of chunks) {
        parser.parseChunk(chunk);
      }

      parser.end();

      expect(onTextDelta).toHaveBeenCalledTimes(3);
      expect(onComplete).toHaveBeenCalledWith("stop");
    });

    it("should track current message ID", () => {
      const parser = createStreamParser({});

      expect(parser.getCurrentMessageId()).toBeNull();

      const chunks = fixtureToUint8Arrays(simpleTextFixture);
      for (const chunk of chunks) {
        parser.parseChunk(chunk);
      }

      expect(parser.getCurrentMessageId()).toBe(simpleTextFixture.messageId);
    });

    it("should reset state", () => {
      const onTextDelta = vi.fn();
      const parser = createStreamParser({ onTextDelta });

      const chunks = fixtureToUint8Arrays(simpleTextFixture);
      for (const chunk of chunks) {
        parser.parseChunk(chunk);
      }

      expect(onTextDelta).toHaveBeenCalledTimes(3);

      parser.reset();

      expect(parser.getCurrentMessageId()).toBeNull();

      // Parse same chunks again
      for (const chunk of chunks) {
        parser.parseChunk(chunk);
      }

      expect(onTextDelta).toHaveBeenCalledTimes(6);
    });

    it("should emit completion once even if end() is called after finish event", () => {
      const onComplete = vi.fn();
      const parser = createStreamParser({ onComplete });
      const chunks = fixtureToUint8Arrays(simpleTextFixture);

      for (const chunk of chunks) {
        parser.parseChunk(chunk);
      }
      parser.end();

      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete).toHaveBeenCalledWith("stop");
    });
  });
});
