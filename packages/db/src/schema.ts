import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
  kind: text("kind").notNull().default("mission"),
  // SDD phase lifecycle: specify → build → verify → archive → done.
  // Plan sessions are unaffected; only mission sessions use this column.
  // Status values align 1:1 with phase names. `done` is terminal.
  status: text("status").notNull().default("specify"),
  // Links a mission session to its SDD change (set when the mission is created
  // from a plan graduation). Null for plan sessions / pre-linkage missions.
  // Used by the runtime to resolve the change dir for progress-aware reminders.
  changeName: text("change_name"),
  // Absolute path to the mission's isolated git worktree. Null = run on
  // project.cwd (plan sessions, pre-isolation missions). Set at plan→mission
  // graduation; cleared at archive→done teardown.
  worktreePath: text("worktree_path"),
  // Pending transition tool-call awaiting resolution. Set server-side when an
  // agent's `transition` tool-call starts; the runner resolves gate/auto and
  // either chains (auto) or leaves it pending for the confirm route (gate).
  // Cleared on the next run. Nullable — null means no pending transition.
  pendingTransitionTo: text("pending_transition_to"),
  pendingTransitionBody: text("pending_transition_body"),
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
    turnId: text("turn_id").references(() => turns.id, { onDelete: "cascade" }),
    isTurnSummary: integer("is_turn_summary", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [
    uniqueIndex("session_entries_session_id_sequence_idx").on(table.sessionId, table.sequence),
    index("session_entries_session_id_kind_idx").on(table.sessionId, table.kind),
    index("session_entries_turn_id_idx").on(table.turnId),
    uniqueIndex("session_entries_turn_id_summary_idx")
      .on(table.turnId)
      .where(sql`is_turn_summary = 1`),
  ],
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
  (table) => [uniqueIndex("turns_session_id_sequence_idx").on(table.sessionId, table.sequence)],
);

// =============================================================================
// Observational Memory (OM) — vocabulary glossary
// -----------------------------------------------------------------------------
// This table stores Observational Memory state, porting Mastra's
// `mastra_observational_memory` shape. OM is a separate concern from the core
// transcript and is keyed by Mastra's vocabulary AT THIS BOUNDARY:
//
//   Mastra "resource"  ==  sakti `projects`        (the codebase being worked on)
//   Mastra "thread"    ==  sakti `sessions`        (one conversation)
//   Mastra "messages"  ==  sakti `session_entries` (rows with kind = "message")
//
// Column mapping at this boundary:
//   observational_memory.resource_id        ->  projects.id
//   observational_memory.thread_id           ->  sessions.id
//   observational_memory.observed_message_ids -> session_entries.id (message kind)
//
// v1 scope: SESSION-scoped (thread) only. lookupKey = `thread:{sessionId}`.
// Project/resource scope is DEFERRED — when added it will use
// `resource:{projectId}` and is a purely additive change (no rewrites).
//
// lookup_key is a REGULAR (non-unique) index: Mastra keeps previous generations
// as history rows; the "current" record is the latest by generationCount.
//
// Source of truth for the shape:
//   openspec/references/mastra/packages/core/src/storage/constants.ts:472
//   openspec/references/mastra/packages/core/src/storage/types.ts:1129
// =============================================================================
export const observationalMemory = sqliteTable(
  "observational_memory",
  {
    id: text("id").primaryKey(),
    lookupKey: text("lookup_key").notNull(),
    scope: text("scope").notNull(), // 'thread' | 'resource'
    resourceId: text("resource_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    threadId: text("thread_id").references(() => sessions.id, {
      onDelete: "cascade",
    }),

    // content
    activeObservations: text("active_observations").notNull(),
    activeObservationsPendingUpdate: text("active_observations_pending_update"),
    bufferedObservationChunks: text("buffered_observation_chunks"), // JSON
    bufferedReflection: text("buffered_reflection"),
    bufferedReflectionTokens: integer("buffered_reflection_tokens"),
    bufferedReflectionInputTokens: integer("buffered_reflection_input_tokens"),
    reflectedObservationLineCount: integer("reflected_observation_line_count"),
    observedMessageIds: text("observed_message_ids"), // JSON array of session_entries.id
    observedTimezone: text("observed_timezone"),

    // generation
    originType: text("origin_type").notNull(), // 'initial' | 'observation' | 'reflection'
    generationCount: integer("generation_count").notNull(),
    config: text("config").notNull(), // JSON snapshot of OM config

    // token accounting
    pendingMessageTokens: integer("pending_message_tokens").notNull(),
    totalTokensObserved: integer("total_tokens_observed").notNull(),
    observationTokenCount: integer("observation_token_count").notNull(),

    // state flags
    isObserving: integer("is_observing", { mode: "boolean" }).notNull().default(false),
    isReflecting: integer("is_reflecting", { mode: "boolean" }).notNull().default(false),
    isBufferingObservation: integer("is_buffering_observation", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    isBufferingReflection: integer("is_buffering_reflection", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    lastBufferedAtTokens: integer("last_buffered_at_tokens").notNull().default(0),

    // cursors / timestamps (epoch-ms integers, consistent with the schema)
    lastObservedAt: integer("last_observed_at"),
    lastReflectionAt: integer("last_reflection_at"),
    lastBufferedAtTime: integer("last_buffered_at_time"),
    metadata: text("metadata"), // JSON
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("observational_memory_lookup_key_idx").on(table.lookupKey)],
);
