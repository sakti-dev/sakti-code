/**
 * Test database setup utilities
 *
 * Provides schema migration for test databases.
 */

import { getDb } from "./index";

/**
 * Setup test database schema
 *
 * Ensures database initialization and migrations have completed.
 */
export async function setupTestDatabase(): Promise<void> {
  const db = await getDb();
  // Keep explicit pragma for tests that may reuse existing connections.
  await db.run(`PRAGMA foreign_keys = ON`);
}

/**
 * Drop all test tables
 */
export async function teardownTestDatabase(): Promise<void> {
  await getDb();
}
