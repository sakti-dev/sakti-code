/**
 * Test database setup utilities
 *
 * Provides schema migration for test databases.
 */

import { getDb } from "./index";

/**
 * Setup test database schema
 *
 * Creates all tables for testing purposes.
 */
export async function setupTestDatabase(): Promise<void> {
  const db = await getDb();

  // Enable foreign keys
  await db.run(`PRAGMA foreign_keys = ON`);

  // Create tables directly using SQL
  await db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      session_id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,
      thread_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_accessed INTEGER NOT NULL
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS tool_sessions (
      tool_session_id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      tool_key TEXT NOT NULL,
      data TEXT,
      created_at INTEGER NOT NULL,
      last_accessed INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
    )
  `);

  await db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS tool_sessions_session_tool_key
    ON tool_sessions (session_id, tool_name, tool_key)
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS repo_cache (
      resource_key TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      ref TEXT NOT NULL,
      search_path TEXT NOT NULL,
      local_path TEXT NOT NULL,
      commit_hash TEXT,
      cloned_at INTEGER NOT NULL,
      last_updated INTEGER NOT NULL
    )
  `);
}

/**
 * Drop all test tables
 */
export async function teardownTestDatabase(): Promise<void> {
  const db = await getDb();
  await db.run(`DROP TABLE IF EXISTS tool_sessions`);
  await db.run(`DROP TABLE IF EXISTS sessions`);
  await db.run(`DROP TABLE IF EXISTS repo_cache`);
}
