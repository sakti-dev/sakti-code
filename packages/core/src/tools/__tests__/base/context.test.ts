/**
 * Tests for context.ts
 *
 * TDD: Tests written first to define expected behavior of getContextOrThrow()
 */

import { Instance } from "@/instance";
import { getContextOrThrow } from "@/tools/base/context";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("getContextOrThrow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("context access", () => {
    it("returns context when called within Instance.provide()", async () => {
      let capturedContext: ReturnType<typeof getContextOrThrow> | undefined;

      await Instance.provide({
        directory: "/test/workspace",
        async fn() {
          capturedContext = getContextOrThrow();
        },
      });

      expect(capturedContext).toBeDefined();
      expect(capturedContext?.directory).toBe("/test/workspace");
      expect(capturedContext?.sessionID).toBeDefined();
      expect(capturedContext?.messageID).toBeDefined();
    });

    it("throws with descriptive error when called outside Instance.provide()", () => {
      expect(() => getContextOrThrow()).toThrow(
        "Tool executed outside of Instance.provide() context"
      );
    });

    it("error message includes guidance on how to fix", () => {
      try {
        getContextOrThrow();
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        const message = (error as Error).message;
        expect(message).toContain("Instance.provide()");
        expect(message).toContain("directory");
        expect(message).toContain("fn");
      }
    });

    it("includes original error details for debugging", async () => {
      let errorMessage: string | undefined;

      await Instance.provide({
        directory: "/test",
        sessionID: "test-session",
        async fn() {
          const context = getContextOrThrow();
          errorMessage = JSON.stringify({
            directory: context.directory,
            sessionID: context.sessionID,
          });
        },
      });

      expect(errorMessage).toBeDefined();
      expect(errorMessage).toContain("/test");
      expect(errorMessage).toContain("test-session");
    });
  });

  describe("context properties", () => {
    it("returns context with all required properties", async () => {
      let capturedContext: ReturnType<typeof getContextOrThrow> | undefined;

      await Instance.provide({
        directory: "/workspace",
        sessionID: "session-123",
        messageID: "message-456",
        agent: "test-agent",
        async fn() {
          capturedContext = getContextOrThrow();
        },
      });

      expect(capturedContext).toEqual(
        expect.objectContaining({
          directory: "/workspace",
          sessionID: "session-123",
          messageID: "message-456",
          agent: "test-agent",
          createdAt: expect.any(Number),
        })
      );
    });

    it("includes optional abort signal when provided", async () => {
      const abortController = new AbortController();
      let capturedContext: ReturnType<typeof getContextOrThrow> | undefined;

      await Instance.provide({
        directory: "/workspace",
        abort: abortController.signal,
        async fn() {
          capturedContext = getContextOrThrow();
        },
      });

      expect(capturedContext?.abort).toBe(abortController.signal);
    });

    it("includes project info after bootstrap", async () => {
      let capturedContext: ReturnType<typeof getContextOrThrow> | undefined;

      await Instance.provide({
        directory: "/workspace",
        async fn() {
          await Instance.bootstrap();
          capturedContext = getContextOrThrow();
        },
      });

      expect(capturedContext?.project).toBeDefined();
      expect(capturedContext?.vcs).toBeDefined();
    });
  });

  describe("nested contexts", () => {
    it("returns inner context when nested provide() with different directory", async () => {
      let outerDir: string | undefined;
      let innerDir: string | undefined;

      await Instance.provide({
        directory: "/outer",
        async fn() {
          outerDir = getContextOrThrow().directory;

          await Instance.provide({
            directory: "/inner",
            async fn() {
              innerDir = getContextOrThrow().directory;
            },
          });
        },
      });

      expect(outerDir).toBe("/outer");
      expect(innerDir).toBe("/inner");
    });

    it("returns same context when nested provide() with same directory", async () => {
      let sessionIdOuter: string | undefined;
      let sessionIdInner: string | undefined;

      await Instance.provide({
        directory: "/workspace",
        sessionID: "shared-session",
        async fn() {
          sessionIdOuter = getContextOrThrow().sessionID;

          await Instance.provide({
            directory: "/workspace",
            sessionID: "shared-session",
            async fn() {
              sessionIdInner = getContextOrThrow().sessionID;
            },
          });
        },
      });

      expect(sessionIdInner).toBe(sessionIdOuter);
    });
  });

  describe("error handling", () => {
    it("provides clear error message for missing context", () => {
      try {
        getContextOrThrow();
        expect.fail("Should have thrown");
      } catch (error) {
        expect((error as Error).message).toMatch(/Tool executed outside/);
        expect((error as Error).message).toMatch(/Instance\.provide/);
        expect((error as Error).message).toMatch(/directory.*fn/);
      }
    });

    it("works correctly after error recovery", async () => {
      // First call outside context (should throw)
      expect(() => getContextOrThrow()).toThrow();

      // Second call inside context (should work)
      let success = false;
      await Instance.provide({
        directory: "/test",
        async fn() {
          getContextOrThrow(); // Should not throw
          success = true;
        },
      });

      expect(success).toBe(true);
    });
  });
});
