import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  cwd: text("cwd").notNull().unique(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id),
  // biome-ignore lint/suspicious/noExplicitAny: Drizzle self-referencing FK needs any return type
  parentSessionId: text("parent_session_id").references((): any => sessions.id),
  title: text("title"),
  modelId: text("model_id"),
  profileId: text("profile_id"),
  kind: text("kind").notNull().default("task"),
  thinkingLevel: text("thinking_level").notNull().default("off"),
  leafId: text("leaf_id"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const sessionEntries = sqliteTable(
  "session_entries",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    parentId: text("parent_id"),
    sequence: integer("sequence").notNull(),
    kind: text("kind").notNull(),
    content: text("content").notNull(),
    timestamp: text("timestamp").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("session_entries_session_id_sequence_idx").on(
      table.sessionId,
      table.sequence
    ),
  ]
);

export const turns = sqliteTable(
  "turns",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    startedAt: integer("started_at").notNull(),
    endedAt: integer("ended_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("turns_session_id_sequence_idx").on(
      table.sessionId,
      table.sequence
    ),
  ]
);
