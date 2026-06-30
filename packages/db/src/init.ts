import type { DatabaseSync } from "node:sqlite";
import { drizzle, type NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";
import * as schema from "./schema.ts";

export type DrizzleDB = NodeSQLiteDatabase<typeof schema>;

export async function initDatabase(
  sqlite: DatabaseSync,
  options?: { migrationsFolder?: string },
): Promise<DrizzleDB> {
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA foreign_keys = ON");

  const db = drizzle({ client: sqlite, schema });
  const migrationsFolder = options?.migrationsFolder ?? `${import.meta.dirname}/../migrations`;
  migrate(db, { migrationsFolder });

  return db;
}
