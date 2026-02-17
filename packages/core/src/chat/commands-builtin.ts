/**
 * Built-in Slash Commands
 *
 * Defines the default set of slash commands available in the command center.
 */

import type { SlashCommand } from "./commands";

export { CommandCatalogItem, SlashCommand } from "./commands";

/**
 * Built-in slash commands
 *
 * These commands are always available and cannot be removed.
 */
export const builtinCommands: SlashCommand[] = [
  // Session commands
  {
    id: "session.new",
    trigger: "new",
    title: "New Session",
    description: "Start a new session",
    keybind: "mod+shift+s",
    type: "builtin",
    source: "command",
  },
  {
    id: "session.undo",
    trigger: "undo",
    title: "Undo",
    description: "Revert to previous message",
    keybind: "mod+z",
    type: "builtin",
    source: "command",
  },
  {
    id: "session.redo",
    trigger: "redo",
    title: "Redo",
    description: "Restore reverted message",
    keybind: "mod+shift+z",
    type: "builtin",
    source: "command",
  },
  {
    id: "session.compact",
    trigger: "compact",
    title: "Compact",
    description: "Summarize session",
    type: "builtin",
    source: "command",
  },
  {
    id: "session.fork",
    trigger: "fork",
    title: "Fork",
    description: "Fork session",
    type: "builtin",
    source: "command",
  },
  {
    id: "session.share",
    trigger: "share",
    title: "Share",
    description: "Share session",
    type: "builtin",
    source: "command",
  },
  {
    id: "session.unshare",
    trigger: "unshare",
    title: "Unshare",
    description: "Remove sharing",
    type: "builtin",
    source: "command",
  },

  // Terminal commands
  {
    id: "terminal.toggle",
    trigger: "terminal",
    title: "Toggle Terminal",
    description: "Show/hide terminal",
    keybind: "mod+`",
    type: "builtin",
    source: "command",
  },
  {
    id: "terminal.new",
    trigger: "new-terminal",
    title: "New Terminal",
    description: "Open new terminal",
    type: "builtin",
    source: "command",
  },

  // Model commands
  {
    id: "model.choose",
    trigger: "model",
    title: "Choose Model",
    description: "Select model",
    type: "builtin",
    source: "command",
  },

  // MCP commands
  {
    id: "mcp.toggle",
    trigger: "mcp",
    title: "Toggle MCP",
    description: "Manage MCP servers",
    type: "builtin",
    source: "command",
  },

  // Agent commands
  {
    id: "agent.cycle",
    trigger: "agent",
    title: "Cycle Agent",
    description: "Switch agent",
    type: "builtin",
    source: "command",
  },

  // UI commands
  {
    id: "steps.toggle",
    trigger: "steps",
    title: "Toggle Steps",
    description: "Show/hide steps",
    type: "builtin",
    source: "command",
  },
];
