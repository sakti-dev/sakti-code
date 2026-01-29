/**
 * Database client setup
 *
 * Provides singleton database client for Drizzle ORM with libsql/SQLite.
 * Uses either remote libsql (Turso) or local SQLite file via @libsql/client.
 */

import { resolveAppPaths } from "@ekacode/shared/paths";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema";

/**
 * Get database URL from environment or use default local file
 */
export function getDatabaseUrl(): string {
  return resolveAppPaths().ekacodeDbUrl;
}

/**
 * Get database auth token for remote libsql (Turso)
 */
export function getDatabaseAuthToken(): string | undefined {
  return process.env.EKACODE_DB_AUTH_TOKEN || process.env.DATABASE_AUTH_TOKEN;
}

/**
 * Create libsql client connection
 *
 * Supports both local file-based SQLite and remote libsql (Turso).
 * @libsql/client uses WASM for local files, avoiding native build issues.
 */
let client: ReturnType<typeof createClient> | null = null;
let drizzleInstance: ReturnType<typeof drizzle> | null = null;
let initPromise: Promise<void> | null = null;

function ensureDbDirectory(url: string): void {
  if (!url.startsWith("file:")) {
    return;
  }
  const filePath = fileURLToPath(url);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

export async function getDb() {
  if (!client) {
    const url = getDatabaseUrl();
    const authToken = getDatabaseAuthToken();

    ensureDbDirectory(url);

    client = createClient({
      url,
      authToken: authToken || undefined,
    });

    // Enable foreign keys for this connection
    initPromise = client.execute("PRAGMA foreign_keys = ON").then(() => undefined);

    drizzleInstance = drizzle(client, { schema });
  }

  if (initPromise) {
    await initPromise;
  }

  return drizzleInstance!;
}

/**
 * Singleton database instance
 */
export const db = await getDb();

/**
 * Close database connection (for cleanup)
 */
export function closeDb(): void {
  if (client) {
    client.close();
    client = null;
    drizzleInstance = null;
    initPromise = null;
  }
}

/**
 * Export schema for use in queries
 */
export * from "./schema";
