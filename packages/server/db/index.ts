/**
 * Database client setup
 *
 * Provides singleton database client for Drizzle ORM with libsql/SQLite.
 * Uses either remote libsql (Turso) or local SQLite file client at runtime.
 *
 * Includes automatic migration on first connection to ensure tables exist.
 */

import { registerCoreDbBindings } from "@sakti-code/shared/core-server-bridge";
import { resolveAppPaths } from "@sakti-code/shared/paths";
import type { Client as LibsqlClient } from "@libsql/client";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runMigrations } from "./migrate";
import * as schema from "./schema";

/**
 * Get database URL from environment or use default local file
 */
export function getDatabaseUrl(): string {
  const envUrl = process.env.DATABASE_URL;
  if (envUrl) {
    if (envUrl.startsWith("file:") || envUrl.startsWith("libsql:")) {
      const filePath = envUrl.replace(/^file:/, "");
      if (path.isAbsolute(filePath)) {
        return envUrl;
      }
      const resolvedPath = path.resolve(process.cwd(), filePath);
      return pathToFileURL(resolvedPath).href;
    }
    if (envUrl.startsWith("http://") || envUrl.startsWith("https://")) {
      return envUrl;
    }
    const resolvedPath = path.resolve(process.cwd(), envUrl);
    return pathToFileURL(resolvedPath).href;
  }
  return resolveAppPaths().sakticodeDbUrl;
}

/**
 * Get database auth token for remote libsql (Turso)
 */
export function getDatabaseAuthToken(): string | undefined {
  return process.env.SAKTI_CODE_DB_AUTH_TOKEN || process.env.DATABASE_AUTH_TOKEN;
}

/**
 * Create libsql client connection
 *
 * Supports both local file-based SQLite and remote libsql (Turso).
 * @libsql/client/node supports Node runtime transports consistently in tests.
 *
 * On first connection, runs Drizzle migrations to ensure schema is up to date.
 */
let client: LibsqlClient | null = null;
let drizzleInstance: LibSQLDatabase<typeof schema> | null = null;
let initPromise: Promise<void> | null = null;

function ensureDbDirectory(url: string): void {
  if (!url.startsWith("file:")) {
    return;
  }
  const filePath = fileURLToPath(url);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

export async function getDb(): Promise<LibSQLDatabase<typeof schema>> {
  if (!client) {
    const url = getDatabaseUrl();
    const authToken = getDatabaseAuthToken();
    const isLocalFileUrl = url.startsWith("file:");

    ensureDbDirectory(url);

    if (isLocalFileUrl) {
      const [{ createClient }, { drizzle }] = await Promise.all([
        import("@libsql/client/sqlite3"),
        import("drizzle-orm/libsql/sqlite3"),
      ]);

      client = createClient({
        url,
        authToken: authToken || undefined,
      }) as LibsqlClient;
      drizzleInstance = drizzle(client, { schema });
    } else {
      const [{ createClient }, { drizzle }] = await Promise.all([
        import("@libsql/client/node"),
        import("drizzle-orm/libsql/node"),
      ]);

      client = createClient({
        url,
        authToken: authToken || undefined,
      }) as LibsqlClient;
      drizzleInstance = drizzle(client, { schema });
    }

    // Initialize: enable foreign keys and run migrations
    initPromise = (async () => {
      // Set busy timeout FIRST - before any other operations
      await client!.execute("PRAGMA busy_timeout = 10000");

      // Enable WAL mode for better concurrency (critical for parallel tests)
      try {
        await client!.execute("PRAGMA journal_mode = WAL");
      } catch {
        // WAL mode may fail if already in WAL - ignore
      }

      // Use NORMAL synchronous for better performance with WAL
      await client!.execute("PRAGMA synchronous = NORMAL");

      // Enable foreign keys
      await client!.execute("PRAGMA foreign_keys = ON");

      // Run Drizzle migrations to ensure schema is up to date
      await runMigrations(drizzleInstance!);
    })();
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

registerCoreDbBindings({
  getDb,
  closeDb,
  sessions: schema.taskSessions,
  tasks: schema.tasks,
  taskDependencies: schema.taskDependencies,
  taskMessages: schema.taskMessages,
  threads: schema.threads,
  messages: schema.messages,
  workingMemory: schema.workingMemory,
  reflections: schema.reflections,
  observationalMemory: schema.observationalMemory,
  toolSessions: schema.toolSessions,
});
