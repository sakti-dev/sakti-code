/**
 * Slash Commands System
 *
 * Defines command types and built-in commands for the command center.
 */

import { z } from "zod";

/**
 * Slash command source
 */
export const CommandSource = z.enum(["command", "mcp", "skill"]);
export type CommandSource = z.infer<typeof CommandSource>;

/**
 * Slash command type
 */
export const CommandType = z.enum(["builtin", "custom"]);
export type CommandType = z.infer<typeof CommandType>;

/**
 * Source of command invocation
 */
export type CommandSourceType = "slash";

/**
 * Slash command schema
 *
 * Represents a slash command that can be executed from the command center.
 */
export const SlashCommand = z
  .object({
    id: z.string(),
    trigger: z.string(),
    title: z.string(),
    description: z.string().optional(),
    keybind: z.string().optional(),
    type: CommandType,
    source: CommandSource.optional(),
    disabled: z.boolean().optional(),
  })
  .meta({
    ref: "SlashCommand",
  });
export type SlashCommand = z.infer<typeof SlashCommand>;

/**
 * Command catalog item for UI display
 *
 * Lighter weight version of SlashCommand for catalog/tree views.
 */
export const CommandCatalogItem = z
  .object({
    title: z.string(),
    description: z.string().optional(),
    category: z.string().optional(),
    keybind: z.string().optional(),
    slash: z.string().optional(),
  })
  .meta({
    ref: "CommandCatalogItem",
  });
export type CommandCatalogItem = z.infer<typeof CommandCatalogItem>;
