/**
 * Prompt Registry Tests
 *
 * TDD tests for prompt registry functionality.
 */

import { describe, expect, it } from "vitest";
import {
  createEmptyPromptRegistry,
  createPromptRegistry,
} from "../../../src/agents/hybrid-agent/prompt-registry";
import type { PromptContext, PromptHandler } from "../../../src/agents/hybrid-agent/types";

describe("Prompt Registry", () => {
  describe("createPromptRegistry", () => {
    it("should create empty registry with no initial handlers", () => {
      const registry = createPromptRegistry();

      expect(registry.get("test")).toBeUndefined();
      expect(registry.list()).toEqual([]);
    });

    it("should create registry with initial handlers", () => {
      const handler1: PromptHandler = {
        id: "test1",
        resolve: () => ({
          system: "System prompt",
          user: "User prompt",
        }),
      };

      const registry = createPromptRegistry([handler1]);

      expect(registry.list()).toHaveLength(1);
      expect(registry.get("test1")).toBeDefined();
    });

    it("should register new handlers", () => {
      const registry = createPromptRegistry();

      const handler: PromptHandler = {
        id: "new-intent",
        resolve: () => ({
          system: "System",
          user: "User",
        }),
      };

      registry.register(handler);

      expect(registry.get("new-intent")).toBeDefined();
      expect(registry.list()).toHaveLength(1);
    });

    it("should resolve prompts by intent ID", () => {
      const registry = createPromptRegistry();

      const handler: PromptHandler = {
        id: "test",
        resolve: (context: PromptContext) => ({
          system: `System for ${context.intentId}`,
          user: `User for ${context.userText}`,
        }),
      };

      registry.register(handler);

      const resolution = registry.resolve({
        intentId: "test",
        userText: "Hello",
      });

      expect(resolution.system).toBe("System for test");
      expect(resolution.user).toBe("User for Hello");
    });

    it("should throw error for unregistered intent", () => {
      const registry = createPromptRegistry();

      expect(() => {
        registry.resolve({
          intentId: "nonexistent",
          userText: "Test",
        });
      }).toThrow("No prompt handler registered for intent: nonexistent");
    });
  });

  describe("createEmptyPromptRegistry", () => {
    it("should create empty registry", () => {
      const registry = createEmptyPromptRegistry();

      expect(registry.list()).toEqual([]);
      expect(registry.get("anything")).toBeUndefined();
    });
  });

  describe("list method", () => {
    it("should return all registered handlers", () => {
      const registry = createPromptRegistry();

      const handler1: PromptHandler = {
        id: "a",
        resolve: () => ({ system: "", user: "" }),
      };
      const handler2: PromptHandler = {
        id: "b",
        resolve: () => ({ system: "", user: "" }),
      };

      registry.register(handler1);
      registry.register(handler2);

      const list = registry.list();
      expect(list).toHaveLength(2);
      expect(list.map(h => h.id)).toContain("a");
      expect(list.map(h => h.id)).toContain("b");
    });
  });
});
