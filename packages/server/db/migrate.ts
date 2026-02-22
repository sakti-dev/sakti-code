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

export type MigrationsSource = "env" | "bundled" | "dev";

interface MigrationsCandidate {
  path: string;
  source: MigrationsSource;
}

export interface ResolvedMigrationsFolder {
  path: string;
  source: MigrationsSource;
  attemptedPaths: string[];
}

function toAbsolutePath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

function getCandidates(): MigrationsCandidate[] {
  const envPath = process.env.SAKTI_CODE_MIGRATIONS_DIR;
  if (envPath) {
    return [{ path: toAbsolutePath(envPath), source: "env" }];
  }

  return [
    // Bundled path adjacent to compiled server output
    { path: path.resolve(__dirname, "../drizzle"), source: "bundled" },
    // Bundled path fallback (when db files are flattened in build output)
    { path: path.resolve(__dirname, "./drizzle"), source: "bundled" },
    // Development source path
    { path: path.resolve(process.cwd(), "packages/server/drizzle"), source: "dev" },
  ];
}

function hasJournal(migrationsFolder: string): boolean {
  return fs.existsSync(path.join(migrationsFolder, "meta/_journal.json"));
}

function journalPathFor(folder: string): string {
  return path.join(folder, "meta/_journal.json");
}

function formatAttemptedPaths(attemptedPaths: string[]): string {
  return attemptedPaths.map(p => `  - ${p}`).join("\n");
}

export function resolveMigrationsFolder(): ResolvedMigrationsFolder {
  const candidates = getCandidates();
  const attemptedPaths = candidates.map(candidate => candidate.path);

  const envPath = process.env.SAKTI_CODE_MIGRATIONS_DIR;
  if (envPath) {
    const onlyCandidate = candidates[0];
    if (!fs.existsSync(onlyCandidate.path)) {
      throw new Error(
        `[db:migration] SAKTI_CODE_MIGRATIONS_DIR does not exist: ${onlyCandidate.path}`
      );
    }
    if (!hasJournal(onlyCandidate.path)) {
      throw new Error(
        `[db:migration] SAKTI_CODE_MIGRATIONS_DIR is missing meta/_journal.json: ${journalPathFor(onlyCandidate.path)}`
      );
    }
    return {
      path: onlyCandidate.path,
      source: onlyCandidate.source,
      attemptedPaths,
    };
  }

  const resolved = candidates.find(
    candidate => fs.existsSync(candidate.path) && hasJournal(candidate.path)
  );
  if (!resolved) {
    throw new Error(
      `[db:migration] No valid migrations folder found. Expected meta/_journal.json in one of:\n${formatAttemptedPaths(attemptedPaths)}`
    );
  }

  return {
    path: resolved.path,
    source: resolved.source,
    attemptedPaths,
  };
}

export function validateMigrationsFolder(migrationsFolder: string): void {
  const journalPath = journalPathFor(migrationsFolder);
  if (!fs.existsSync(journalPath)) {
    throw new Error(`[db:migration] Missing migration journal: ${journalPath}`);
  }

  let journal: { entries?: Array<{ tag?: string }> };
  try {
    journal = JSON.parse(fs.readFileSync(journalPath, "utf-8")) as {
      entries?: Array<{ tag?: string }>;
    };
  } catch (error) {
    throw new Error(
      `[db:migration] Invalid migration journal JSON at ${journalPath}: ${String(error)}`
    );
  }

  if (!Array.isArray(journal.entries)) {
    throw new Error(`[db:migration] Invalid migration journal entries at ${journalPath}`);
  }

  for (const entry of journal.entries) {
    if (!entry?.tag) {
      throw new Error(`[db:migration] Migration journal entry missing tag in ${journalPath}`);
    }
    const sqlPath = path.join(migrationsFolder, `${entry.tag}.sql`);
    if (!fs.existsSync(sqlPath)) {
      throw new Error(`[db:migration] Migration journal references missing SQL file: ${sqlPath}`);
    }
  }
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
  const resolved = resolveMigrationsFolder();
  validateMigrationsFolder(resolved.path);
  console.log(`[db:migration] Running migrations from (${resolved.source}): ${resolved.path}`);

  try {
    await migrate(db, { migrationsFolder: resolved.path });
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
  try {
    const resolved = resolveMigrationsFolder();
    validateMigrationsFolder(resolved.path);
    return {
      exists: true,
      path: resolved.path,
    };
  } catch {
    return {
      exists: false,
      path: "",
    };
  }
}
