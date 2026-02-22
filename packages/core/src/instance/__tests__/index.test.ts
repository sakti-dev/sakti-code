/**
 * Instance API tests
 *
 * TDD: Tests written first to define expected behavior of Instance.provide() and public API
 */

import { Instance } from "@/instance";
import { describe, expect, it } from "vitest";

describe("Instance", () => {
  describe("provide()", () => {
    it("establishes context and executes function", async () => {
      let inContext = false;
      let capturedDirectory: string | undefined;

      await Instance.provide({
        directory: "/test/project",
        async fn() {
          inContext = Instance.inContext;
          capturedDirectory = Instance.directory;
        },
      });

      expect(inContext).toBe(true);
      expect(capturedDirectory).toBe("/test/project");
    });

    it("returns value from function", async () => {
      const result = await Instance.provide({
        directory: "/test",
        async fn() {
          return "success";
        },
      });

      expect(result).toBe("success");
    });

    it("propagates errors from function", async () => {
      await expect(
        Instance.provide({
          directory: "/test",
          async fn() {
            throw new Error("test error");
          },
        })
      ).rejects.toThrow("test error");
    });

    it("resolves relative directory to absolute", async () => {
      await Instance.provide({
        directory: "relative/path",
        async fn() {
          expect(Instance.directory).toMatch(/\/relative\/path$/);
          expect(Instance.directory).not.toBe("relative/path");
        },
      });
    });

    it("generates UUIDv7 session and message IDs", async () => {
      await Instance.provide({
        directory: "/test",
        async fn() {
          const context = Instance.context;
          // UUIDv7 format: 8-4-4-4-12 hex digits with hyphens
          const uuidv7Pattern =
            /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
          expect(context.sessionID).toMatch(uuidv7Pattern);
          expect(context.messageID).toMatch(uuidv7Pattern);
          expect(context.sessionID).not.toBe(context.messageID);
        },
      });
    });

    it("uses provided sessionID and messageID when supplied", async () => {
      await Instance.provide({
        directory: "/test",
        sessionID: "session-override",
        messageID: "message-override",
        async fn() {
          const context = Instance.context;
          expect(context.sessionID).toBe("session-override");
          expect(context.messageID).toBe("message-override");
        },
      });
    });

    it("creates new context for each provide() call", async () => {
      const sessionIds: string[] = [];

      await Instance.provide({
        directory: "/test",
        async fn() {
          sessionIds.push(Instance.context.sessionID);
        },
      });

      await Instance.provide({
        directory: "/test",
        async fn() {
          sessionIds.push(Instance.context.sessionID);
        },
      });

      expect(sessionIds).toHaveLength(2);
      expect(sessionIds[0]).not.toBe(sessionIds[1]);
    });
  });

  describe("nested provide()", () => {
    it("reuses context when directory matches", async () => {
      let sessionIdOuter: string | undefined;
      let sessionIdInner: string | undefined;

      await Instance.provide({
        directory: "/test",
        async fn() {
          sessionIdOuter = Instance.context.sessionID;

          await Instance.provide({
            directory: "/test",
            async fn() {
              sessionIdInner = Instance.context.sessionID;
            },
          });
        },
      });

      expect(sessionIdInner).toBe(sessionIdOuter);
    });

    it("creates nested context when sessionID differs", async () => {
      let sessionIdOuter: string | undefined;
      let sessionIdInner: string | undefined;

      await Instance.provide({
        directory: "/test",
        sessionID: "session-a",
        async fn() {
          sessionIdOuter = Instance.context.sessionID;

          await Instance.provide({
            directory: "/test",
            sessionID: "session-b",
            async fn() {
              sessionIdInner = Instance.context.sessionID;
            },
          });
        },
      });

      expect(sessionIdInner).not.toBe(sessionIdOuter);
    });

    it("creates nested context when directory differs", async () => {
      let sessionIdOuter: string | undefined;
      let sessionIdInner: string | undefined;

      await Instance.provide({
        directory: "/test",
        async fn() {
          sessionIdOuter = Instance.context.sessionID;

          await Instance.provide({
            directory: "/other",
            async fn() {
              sessionIdInner = Instance.context.sessionID;
            },
          });
        },
      });

      expect(sessionIdInner).not.toBe(sessionIdOuter);
    });

    it("restores outer context after inner provide()", async () => {
      let outerDir: string | undefined;
      let innerDir: string | undefined;
      let restoredDir: string | undefined;

      await Instance.provide({
        directory: "/outer",
        async fn() {
          outerDir = Instance.directory;

          await Instance.provide({
            directory: "/inner",
            async fn() {
              innerDir = Instance.directory;
            },
          });

          restoredDir = Instance.directory;
        },
      });

      expect(outerDir).toBe("/outer");
      expect(innerDir).toBe("/inner");
      expect(restoredDir).toBe("/outer");
    });
  });

  describe("context access", () => {
    it("throws when directory accessed outside provide()", () => {
      expect(() => Instance.directory).toThrow(
        "Instance context accessed outside of Instance.provide()"
      );
    });

    it("throws when context accessed outside provide()", () => {
      expect(() => Instance.context).toThrow(
        "Instance context accessed outside of Instance.provide()"
      );
    });

    it("returns undefined for project outside provide()", () => {
      expect(Instance.project).toBeUndefined();
    });

    it("returns undefined for vcs outside provide()", () => {
      expect(Instance.vcs).toBeUndefined();
    });

    it("returns false for inContext outside provide()", () => {
      expect(Instance.inContext).toBe(false);
    });
  });

  describe("inContext", () => {
    it("returns false outside provide()", () => {
      expect(Instance.inContext).toBe(false);
    });

    it("returns true inside provide()", async () => {
      await Instance.provide({
        directory: "/test",
        async fn() {
          expect(Instance.inContext).toBe(true);
        },
      });
    });

    it("returns false after provide() completes", async () => {
      await Instance.provide({
        directory: "/test",
        async fn() {
          // inside context
        },
      });

      expect(Instance.inContext).toBe(false);
    });
  });

  describe("state", () => {
    it("persists state across provide() calls with same directory", async () => {
      await Instance.provide({
        directory: "/test",
        async fn() {
          Instance.state.set("key", "value1");
        },
      });

      await Instance.provide({
        directory: "/test",
        async fn() {
          expect(Instance.state.get("key")).toBe("value1");
        },
      });
    });

    it("isolates state between different directories", async () => {
      await Instance.provide({
        directory: "/a",
        async fn() {
          Instance.state.set("key", "value-a");
        },
      });

      await Instance.provide({
        directory: "/b",
        async fn() {
          expect(Instance.state.get("key")).toBeUndefined();
          Instance.state.set("key", "value-b");
        },
      });

      await Instance.provide({
        directory: "/a",
        async fn() {
          expect(Instance.state.get("key")).toBe("value-a");
        },
      });
    });

    it("clears state", async () => {
      await Instance.provide({
        directory: "/test",
        async fn() {
          Instance.state.set("key", "value");
          Instance.state.clear();
          expect(Instance.state.get("key")).toBeUndefined();
        },
      });
    });

    it("returns undefined for missing keys", async () => {
      await Instance.provide({
        directory: "/test",
        async fn() {
          expect(Instance.state.get("missing")).toBeUndefined();
        },
      });
    });
  });

  describe("bootstrap", () => {
    it("initializes project and vcs information", async () => {
      await Instance.provide({
        directory: "/test",
        async fn() {
          await Instance.bootstrap();
          // bootstrap should populate project and vcs
          expect(Instance.project).toBeDefined();
          expect(Instance.vcs).toBeDefined();
        },
      });
    });
  });
});
