/**
 * Tests for Message Sealing System - TDD
 *
 * Tests verify:
 * - sealMessage: Marks messages as sealed with timestamp
 * - ObservationMarkers: Constants for start/end/failed markers
 * - isObservationMarker: Detects marker parts
 * - insertObservationMarker: Adds markers to messages
 * - findLastCompletedObservationBoundary: Finds end markers
 * - getUnobservedParts: Returns unobserved message parts
 * - isMessageSealed: Checks if message is sealed
 * - getMessageSealedAt: Gets seal timestamp
 */

import { describe, expect, it } from "vitest";
import type { SealedMessage } from "@/memory/observation/sealing";

describe("Message Sealing System", () => {
  describe("ObservationMarkers", () => {
    it("should have START marker constant", async () => {
      const { ObservationMarkers } = await import("@/memory/observation/sealing");
      expect(ObservationMarkers.START).toBe("data-om-observation-start");
    });

    it("should have END marker constant", async () => {
      const { ObservationMarkers } = await import("@/memory/observation/sealing");
      expect(ObservationMarkers.END).toBe("data-om-observation-end");
    });

    it("should have FAILED marker constant", async () => {
      const { ObservationMarkers } = await import("@/memory/observation/sealing");
      expect(ObservationMarkers.FAILED).toBe("data-om-observation-failed");
    });
  });

  describe("isObservationMarker", () => {
    it("should return true for START marker", async () => {
      const { isObservationMarker } = await import("@/memory/observation/sealing");
      const part = { type: "data-om-observation-start" };
      expect(isObservationMarker(part)).toBe(true);
    });

    it("should return true for END marker", async () => {
      const { isObservationMarker } = await import("@/memory/observation/sealing");
      const part = { type: "data-om-observation-end" };
      expect(isObservationMarker(part)).toBe(true);
    });

    it("should return true for FAILED marker", async () => {
      const { isObservationMarker } = await import("@/memory/observation/sealing");
      const part = { type: "data-om-observation-failed" };
      expect(isObservationMarker(part)).toBe(true);
    });

    it("should return false for regular text part", async () => {
      const { isObservationMarker } = await import("@/memory/observation/sealing");
      const part = { type: "text", text: "Hello" };
      expect(isObservationMarker(part)).toBe(false);
    });
  });

  describe("sealMessage", () => {
    it("should mark message as sealed", async () => {
      const { sealMessage } = await import("@/memory/observation/sealing");
      const message: SealedMessage = {
        id: "msg-1",
        role: "user" as const,
        content: {
          parts: [{ type: "text", text: "Hello" }],
        },
      };

      sealMessage(message);

      expect(message.content.metadata?.mastra?.sealed).toBe(true);
    });

    it("should add sealedAt timestamp to last part", async () => {
      const { sealMessage } = await import("@/memory/observation/sealing");
      const before = Date.now();
      const message: SealedMessage = {
        id: "msg-1",
        role: "user" as const,
        content: {
          parts: [{ type: "text", text: "Hello" }],
        },
      };

      sealMessage(message);
      const after = Date.now();

      const sealedAt = message.content.parts[0].metadata?.mastra?.sealedAt;
      expect(sealedAt).toBeDefined();
      expect(sealedAt).toBeGreaterThanOrEqual(before);
      expect(sealedAt).toBeLessThanOrEqual(after);
    });

    it("should handle messages without metadata", async () => {
      const { sealMessage } = await import("@/memory/observation/sealing");
      const message: SealedMessage = {
        id: "msg-1",
        role: "user" as const,
        content: {
          parts: [{ type: "text", text: "Hello" }],
        },
      };

      sealMessage(message);

      expect(message.content.metadata).toBeDefined();
      expect(message.content.metadata?.mastra).toBeDefined();
    });
  });

  describe("insertObservationMarker", () => {
    it("should insert START marker", async () => {
      const { insertObservationMarker, ObservationMarkers } =
        await import("@/memory/observation/sealing");
      const message: SealedMessage = {
        id: "msg-1",
        role: "user" as const,
        content: {
          parts: [{ type: "text", text: "Hello" }],
        },
      };

      insertObservationMarker(message, "start");

      const lastPart = message.content.parts[message.content.parts.length - 1];
      expect(lastPart.type).toBe(ObservationMarkers.START);
    });

    it("should insert END marker", async () => {
      const { insertObservationMarker, ObservationMarkers } =
        await import("@/memory/observation/sealing");
      const message: SealedMessage = {
        id: "msg-1",
        role: "user" as const,
        content: {
          parts: [{ type: "text", text: "Hello" }],
        },
      };

      insertObservationMarker(message, "end");

      const lastPart = message.content.parts[message.content.parts.length - 1];
      expect(lastPart.type).toBe(ObservationMarkers.END);
    });

    it("should add timestamp to marker", async () => {
      const { insertObservationMarker } = await import("@/memory/observation/sealing");
      const before = Date.now();
      const message: SealedMessage = {
        id: "msg-1",
        role: "user" as const,
        content: {
          parts: [{ type: "text", text: "Hello" }],
        },
      };

      insertObservationMarker(message, "start");
      const after = Date.now();

      const lastPart = message.content.parts[message.content.parts.length - 1];
      const timestamp = lastPart.metadata?.mastra?.sealedAt;
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe("findLastCompletedObservationBoundary", () => {
    it("should return -1 when no end marker exists", async () => {
      const { findLastCompletedObservationBoundary } =
        await import("@/memory/observation/sealing");
      const message: SealedMessage = {
        id: "msg-1",
        role: "user" as const,
        content: {
          parts: [
            { type: "text", text: "Hello" },
            { type: "text", text: "World" },
          ],
        },
      };

      const result = findLastCompletedObservationBoundary(message);
      expect(result).toBe(-1);
    });

    it("should find index of last END marker", async () => {
      const { findLastCompletedObservationBoundary, ObservationMarkers } =
        await import("@/memory/observation/sealing");
      const message: SealedMessage = {
        id: "msg-1",
        role: "user" as const,
        content: {
          parts: [
            { type: "text", text: "Hello" },
            { type: ObservationMarkers.END },
            { type: "text", text: "World" },
          ],
        },
      };

      const result = findLastCompletedObservationBoundary(message);
      expect(result).toBe(1);
    });

    it("should return index of last END when multiple exist", async () => {
      const { findLastCompletedObservationBoundary, ObservationMarkers } =
        await import("@/memory/observation/sealing");
      const message: SealedMessage = {
        id: "msg-1",
        role: "user" as const,
        content: {
          parts: [
            { type: ObservationMarkers.END },
            { type: "text", text: "Hello" },
            { type: ObservationMarkers.END },
          ],
        },
      };

      const result = findLastCompletedObservationBoundary(message);
      expect(result).toBe(2);
    });
  });

  describe("getUnobservedParts", () => {
    it("should return all parts when no end marker", async () => {
      const { getUnobservedParts } = await import("@/memory/observation/sealing");
      const message: SealedMessage = {
        id: "msg-1",
        role: "user" as const,
        content: {
          parts: [
            { type: "text", text: "Hello" },
            { type: "text", text: "World" },
          ],
        },
      };

      const result = getUnobservedParts(message);
      expect(result).toHaveLength(2);
      expect(result[0].text).toBe("Hello");
      expect(result[1].text).toBe("World");
    });

    it("should return only parts after last END marker", async () => {
      const { getUnobservedParts, ObservationMarkers } =
        await import("@/memory/observation/sealing");
      const message: SealedMessage = {
        id: "msg-1",
        role: "user" as const,
        content: {
          parts: [
            { type: "text", text: "Old" },
            { type: ObservationMarkers.END },
            { type: "text", text: "New" },
          ],
        },
      };

      const result = getUnobservedParts(message);
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe("New");
    });

    it("should filter out marker parts", async () => {
      const { getUnobservedParts, ObservationMarkers } =
        await import("@/memory/observation/sealing");
      const message: SealedMessage = {
        id: "msg-1",
        role: "user" as const,
        content: {
          parts: [
            { type: "text", text: "Hello" },
            { type: ObservationMarkers.START },
            { type: "text", text: "World" },
          ],
        },
      };

      const result = getUnobservedParts(message);
      expect(result).toHaveLength(2);
      expect(result.some(p => p.type === ObservationMarkers.START)).toBe(false);
    });

    it("should return empty array for empty parts", async () => {
      const { getUnobservedParts } = await import("@/memory/observation/sealing");
      const message: SealedMessage = {
        id: "msg-1",
        role: "user" as const,
        content: {
          parts: [],
        },
      };

      const result = getUnobservedParts(message);
      expect(result).toHaveLength(0);
    });
  });

  describe("isMessageSealed", () => {
    it("should return true for sealed message", async () => {
      const { isMessageSealed, sealMessage } =
        await import("@/memory/observation/sealing");
      const message: SealedMessage = {
        id: "msg-1",
        role: "user" as const,
        content: {
          parts: [{ type: "text", text: "Hello" }],
        },
      };

      sealMessage(message);

      expect(isMessageSealed(message)).toBe(true);
    });

    it("should return false for unsealed message", async () => {
      const { isMessageSealed } = await import("@/memory/observation/sealing");
      const message: SealedMessage = {
        id: "msg-1",
        role: "user" as const,
        content: {
          parts: [{ type: "text", text: "Hello" }],
        },
      };

      expect(isMessageSealed(message)).toBe(false);
    });
  });

  describe("getMessageSealedAt", () => {
    it("should return timestamp for sealed message", async () => {
      const { getMessageSealedAt, sealMessage } =
        await import("@/memory/observation/sealing");
      const message: SealedMessage = {
        id: "msg-1",
        role: "user" as const,
        content: {
          parts: [{ type: "text", text: "Hello" }],
        },
      };

      const before = Date.now();
      sealMessage(message);
      const after = Date.now();

      const sealedAt = getMessageSealedAt(message);
      expect(sealedAt).toBeDefined();
      expect(sealedAt).toBeGreaterThanOrEqual(before);
      expect(sealedAt).toBeLessThanOrEqual(after);
    });

    it("should return undefined for unsealed message", async () => {
      const { getMessageSealedAt } = await import("@/memory/observation/sealing");
      const message: SealedMessage = {
        id: "msg-1",
        role: "user" as const,
        content: {
          parts: [{ type: "text", text: "Hello" }],
        },
      };

      expect(getMessageSealedAt(message)).toBeUndefined();
    });
  });
});
