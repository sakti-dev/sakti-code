/**
 * Database schema definitions
 *
 * Defines tables for sessions, tool_sessions, and repo_cache using Drizzle ORM.
 */

import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Sessions table - stores core session data with UUIDv7 identifiers
 *
 * - session_id: UUIDv7 primary key
 * - resource_id: User ID or "local" for single-user desktop
 * - thread_id: Equal to session_id (for Mastra Memory integration)
 * - created_at: Unix timestamp in milliseconds
 * - last_accessed: Unix timestamp in milliseconds
 */
export const sessions = sqliteTable("sessions", {
  session_id: text("session_id").primaryKey(),
  resource_id: text("resource_id").notNull(),
  thread_id: text("thread_id").notNull(),
  created_at: integer("created_at", { mode: "timestamp" }).notNull(),
  last_accessed: integer("last_accessed", { mode: "timestamp" }).notNull(),
});

/**
 * Tool sessions table - provides per-tool session isolation
 *
 * - tool_session_id: UUIDv7 primary key
 * - session_id: Foreign key to sessions (cascades on delete)
 * - tool_name: Tool identifier (e.g., "sequential-thinking")
 * - tool_key: Optional sub-key for multiple instances of same tool
 * - data: JSON-encoded tool-specific state
 * - created_at: Unix timestamp in milliseconds
 */
export const toolSessions = sqliteTable(
  "tool_sessions",
  {
    tool_session_id: text("tool_session_id").primaryKey(),
    session_id: text("session_id")
      .notNull()
      .references(() => sessions.session_id, { onDelete: "cascade" }),
    tool_name: text("tool_name").notNull(),
    tool_key: text("tool_key").notNull(),
    data: text("data", { mode: "json" }).$type<unknown>(),
    created_at: integer("created_at", { mode: "timestamp" }).notNull(),
    last_accessed: integer("last_accessed", { mode: "timestamp" }).notNull(),
  },
  table => ({
    sessionToolKey: uniqueIndex("tool_sessions_session_tool_key").on(
      table.session_id,
      table.tool_name,
      table.tool_key
    ),
  })
);

/**
 * Repo cache table - caches repository metadata
 *
 * - resource_key: Primary key (e.g., "repo:owner/name")
 * - url/ref/search_path: Source metadata
 * - local_path: Local filesystem path
 * - commit_hash: Current commit hash
 * - cloned_at/last_updated: Unix timestamps in milliseconds
 */
export const repoCache = sqliteTable("repo_cache", {
  resource_key: text("resource_key").primaryKey(),
  url: text("url").notNull(),
  ref: text("ref").notNull(),
  search_path: text("search_path").notNull(),
  local_path: text("local_path").notNull(),
  commit_hash: text("commit_hash"),
  cloned_at: integer("cloned_at", { mode: "timestamp" }).notNull(),
  last_updated: integer("last_updated", { mode: "timestamp" }).notNull(),
});

/**
 * Type definitions for TypeScript
 */
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type ToolSession = typeof toolSessions.$inferSelect;
export type NewToolSession = typeof toolSessions.$inferInsert;
export type RepoCache = typeof repoCache.$inferSelect;
export type NewRepoCache = typeof repoCache.$inferInsert;
