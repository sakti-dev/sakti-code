import type { Database } from "bun:sqlite";
import { type BunSQLiteDatabase, drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "./schema.ts";

export type DrizzleDB = BunSQLiteDatabase<typeof schema>;

export async function initDatabase(sqlite: Database): Promise<DrizzleDB> {
  // Enable WAL mode and foreign keys
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA foreign_keys = ON");

  const db = drizzle(sqlite, { schema });

  // Create tables with raw SQL
  sqlite.exec(getCreateTableSQL(schema));

  return db;
}

function getCreateTableSQL(_s: typeof schema): string {
  return `
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cwd TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      title TEXT,
      model_id TEXT NOT NULL,
      thinking_level TEXT NOT NULL DEFAULT 'off',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_calls TEXT,
      tool_call_id TEXT,
      tool_name TEXT,
      tool_arguments TEXT,
      is_error INTEGER,
      usage TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tool_executions (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES messages(id),
      session_id TEXT NOT NULL REFERENCES sessions(id),
      tool_name TEXT NOT NULL,
      arguments TEXT NOT NULL,
      result TEXT,
      duration_ms INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS costs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      project_id TEXT NOT NULL REFERENCES projects(id),
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cost_usd REAL NOT NULL,
      model_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS model_configs (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id),
      provider TEXT NOT NULL,
      model_id TEXT NOT NULL,
      thinking_level TEXT NOT NULL DEFAULT 'off',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `;
}
