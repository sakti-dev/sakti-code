import type { Database } from "bun:sqlite";
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema.ts";

export type DrizzleDB = BunSQLiteDatabase<typeof schema>;

export async function initDatabase(
  sqlite: Database,
  options?: { migrationsFolder?: string }
): Promise<DrizzleDB> {
  sqlite.run("PRAGMA journal_mode = WAL");
  sqlite.run("PRAGMA foreign_keys = ON");

  const db = drizzle(sqlite, { schema });
  const migrationsFolder =
    options?.migrationsFolder ?? `${import.meta.dir}/../migrations`;
  migrate(db, { migrationsFolder });

  return db;
}
