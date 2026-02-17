/**
 * Tests for slash commands system
 *
 * Validates command types, built-in commands, and command execution.
 */

import { describe, expect, it } from "vitest";
import { CommandCatalogItem, SlashCommand, builtinCommands } from "../../src/chat/commands-builtin";

describe("chat/commands", () => {
  describe("SlashCommand", () => {
    it("should validate a valid slash command", () => {
      const cmd = {
        id: "session.new",
        trigger: "new",
        title: "New Session",
        description: "Start a new session",
        keybind: "mod+shift+s",
        type: "builtin" as const,
        source: "command",
      };

      const result = SlashCommand.safeParse(cmd);
      expect(result.success).toBe(true);
    });

    it("should require id, trigger, title, and type", () => {
      const cmd = {
        id: "session.new",
        title: "New Session",
      };

      const result = SlashCommand.safeParse(cmd);
      expect(result.success).toBe(false);
    });

    it("should allow optional fields", () => {
      const cmd = {
        id: "session.new",
        trigger: "new",
        title: "New Session",
        type: "builtin" as const,
      };

      const result = SlashCommand.safeParse(cmd);
      expect(result.success).toBe(true);
    });

    it("should validate type is either builtin or custom", () => {
      const validCmd = {
        id: "custom.cmd",
        trigger: "cmd",
        title: "Custom Command",
        type: "custom" as const,
      };

      const result = SlashCommand.safeParse(validCmd);
      expect(result.success).toBe(true);
    });
  });

  describe("CommandCatalogItem", () => {
    it("should validate a valid catalog item", () => {
      const item = {
        title: "New Session",
        description: "Start a new session",
        keybind: "mod+shift+s",
        slash: "new",
      };

      const result = CommandCatalogItem.safeParse(item);
      expect(result.success).toBe(true);
    });

    it("should allow minimal catalog item with just title", () => {
      const item = {
        title: "New Session",
      };

      const result = CommandCatalogItem.safeParse(item);
      expect(result.success).toBe(true);
    });
  });

  describe("builtinCommands", () => {
    it("should have session.new command", () => {
      const cmd = builtinCommands.find(c => c.id === "session.new");
      expect(cmd).toBeDefined();
      expect(cmd?.trigger).toBe("new");
      expect(cmd?.title).toBe("New Session");
      expect(cmd?.type).toBe("builtin");
    });

    it("should have session.undo command", () => {
      const cmd = builtinCommands.find(c => c.id === "session.undo");
      expect(cmd).toBeDefined();
      expect(cmd?.trigger).toBe("undo");
      expect(cmd?.title).toBe("Undo");
    });

    it("should have session.redo command", () => {
      const cmd = builtinCommands.find(c => c.id === "session.redo");
      expect(cmd).toBeDefined();
      expect(cmd?.trigger).toBe("redo");
      expect(cmd?.title).toBe("Redo");
    });

    it("should have session.compact command", () => {
      const cmd = builtinCommands.find(c => c.id === "session.compact");
      expect(cmd).toBeDefined();
      expect(cmd?.trigger).toBe("compact");
      expect(cmd?.title).toBe("Compact");
    });

    it("should have session.fork command", () => {
      const cmd = builtinCommands.find(c => c.id === "session.fork");
      expect(cmd).toBeDefined();
      expect(cmd?.trigger).toBe("fork");
      expect(cmd?.title).toBe("Fork");
    });

    it("should have session.share command", () => {
      const cmd = builtinCommands.find(c => c.id === "session.share");
      expect(cmd).toBeDefined();
      expect(cmd?.trigger).toBe("share");
      expect(cmd?.title).toBe("Share");
    });

    it("should have session.unshare command", () => {
      const cmd = builtinCommands.find(c => c.id === "session.unshare");
      expect(cmd).toBeDefined();
      expect(cmd?.trigger).toBe("unshare");
      expect(cmd?.title).toBe("Unshare");
    });

    it("should have terminal.toggle command", () => {
      const cmd = builtinCommands.find(c => c.id === "terminal.toggle");
      expect(cmd).toBeDefined();
      expect(cmd?.trigger).toBe("terminal");
      expect(cmd?.title).toBe("Toggle Terminal");
    });

    it("should have terminal.new command", () => {
      const cmd = builtinCommands.find(c => c.id === "terminal.new");
      expect(cmd).toBeDefined();
      expect(cmd?.trigger).toBe("new-terminal");
      expect(cmd?.title).toBe("New Terminal");
    });

    it("should have model.choose command", () => {
      const cmd = builtinCommands.find(c => c.id === "model.choose");
      expect(cmd).toBeDefined();
      expect(cmd?.trigger).toBe("model");
      expect(cmd?.title).toBe("Choose Model");
    });

    it("should have mcp.toggle command", () => {
      const cmd = builtinCommands.find(c => c.id === "mcp.toggle");
      expect(cmd).toBeDefined();
      expect(cmd?.trigger).toBe("mcp");
      expect(cmd?.title).toBe("Toggle MCP");
    });

    it("should have agent.cycle command", () => {
      const cmd = builtinCommands.find(c => c.id === "agent.cycle");
      expect(cmd).toBeDefined();
      expect(cmd?.trigger).toBe("agent");
      expect(cmd?.title).toBe("Cycle Agent");
    });

    it("should have steps.toggle command", () => {
      const cmd = builtinCommands.find(c => c.id === "steps.toggle");
      expect(cmd).toBeDefined();
      expect(cmd?.trigger).toBe("steps");
      expect(cmd?.title).toBe("Toggle Steps");
    });

    it("should have all 13 built-in commands", () => {
      expect(builtinCommands).toHaveLength(13);
    });

    it("should be able to filter commands by trigger", () => {
      const filtered = builtinCommands.filter(c => c.trigger.startsWith("new"));
      expect(filtered.length).toBeGreaterThan(0);
    });
  });
});
