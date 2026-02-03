/**
 * Database migration module
 *
 * Runs Drizzle-kit generated migrations at runtime.
 * Migrations are stored in /drizzle folder and bundled with the app.
 *
 * This approach handles version upgrades properly:
 * - User on v1.0.0 has migrations 0000 applied
 * - User upgrades to v1.2.0, migrations 0001, 0002 are applied
 * - Applied migrations tracked in __drizzle_migrations table
 */

import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get the migrations folder path based on environment
 *
 * Development: relative to server package source
 * Production: bundled with electron app
 */
function getMigrationsFolder(): string {
  // Try multiple possible locations
  const possiblePaths = [
    // Development: relative to db folder
    path.resolve(__dirname, "../drizzle"),
    // Development (Monorepo): relative from dist/index.js to packages/server/drizzle
    path.resolve(__dirname, "../../../packages/server/drizzle"),
    // Production: bundled alongside the main index.js
    path.resolve(__dirname, "./drizzle"),
    // Alternative production path
    path.resolve(process.cwd(), "drizzle"),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p) && fs.existsSync(path.join(p, "meta/_journal.json"))) {
      return p;
    }
  }

  // Default to first path (will error if not found)
  console.warn("[db:migration] No migrations folder found, using default path");
  return possiblePaths[0];
}

/**
 * Run database migrations
 *
 * Uses Drizzle's migrate function which:
 * 1. Reads meta/_journal.json to find all migrations
 * 2. Checks __drizzle_migrations table for applied migrations
 * 3. Applies only new migrations in order
 *
 * Safe to run on every app startup - only applies pending migrations.
 *
 * @param db - Drizzle database instance
 */
export async function runMigrations<T extends Record<string, unknown>>(
  db: LibSQLDatabase<T>
): Promise<void> {
  const migrationsFolder = getMigrationsFolder();
  console.log(`[db:migration] Running migrations from: ${migrationsFolder}`);

  try {
    await migrate(db, { migrationsFolder });
    console.log("[db:migration] Migrations complete");
  } catch (error) {
    console.error("[db:migration] Migration failed:", error);
    throw error;
  }
}

/**
 * Check if migrations folder exists and is valid
 */
export function checkMigrationsFolder(): { exists: boolean; path: string } {
  const migrationsFolder = getMigrationsFolder();
  const journalPath = path.join(migrationsFolder, "meta/_journal.json");
  return {
    exists: fs.existsSync(journalPath),
    path: migrationsFolder,
  };
}
