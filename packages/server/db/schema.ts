/**
 * Database schema definitions
 *
 * Defines tables for sessions, tool_sessions, and repo_cache using Drizzle ORM.
 */

import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * Workspaces table - stores workspace/project information
 *
 * A workspace represents a git worktree directory in the app.
 * - id: UUIDv7 primary key
 * - path: Absolute filesystem path (unique)
 * - name: Display name
 * - status: "active" or "archived"
 * - base_branch: Base branch for the worktree
 * - repo_path: Path to the main repo (for worktrees)
 * - is_merged: Whether the worktree has been merged
 * - archived_at: When the workspace was archived
 * - created_at: When the workspace was created
 * - last_opened_at: When the workspace was last opened
 */
export const workspaces = sqliteTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    path: text("path").notNull().unique(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    base_branch: text("base_branch"),
    repo_path: text("repo_path"),
    is_merged: integer("is_merged", { mode: "boolean" }).default(false),
    archived_at: integer("archived_at", { mode: "timestamp" }),
    created_at: integer("created_at", { mode: "timestamp" }).notNull(),
    last_opened_at: integer("last_opened_at", { mode: "timestamp" }).notNull(),
  },
  table => ({
    statusIndex: index("workspaces_status_idx").on(table.status),
    lastOpenedIndex: index("workspaces_last_opened_idx").on(table.last_opened_at),
  })
);

/**
 * Task Sessions table - stores task session data with UUIDv7 identifiers
 *
 * - session_id: UUIDv7 primary key
 * - resource_id: User ID or "local" for single-user desktop
 * - thread_id: Equal to session_id (for Mastra Memory integration)
 * - parent_id: Parent session ID for hierarchy support
 * - workspace_id: Foreign key to workspaces (optional)
 * - title: Display title for the session
 * - summary: JSON-encoded session summary (additions, deletions, files, diffs)
 * - share_url: Optional URL for shared sessions
 * - created_at: Unix timestamp in milliseconds
 * - last_accessed: Unix timestamp in milliseconds
 * - status: Task session status (researching | specifying | implementing | completed | failed)
 * - spec_type: Spec type (comprehensive | quick | null)
 * - session_kind: Session kind (intake | task) - intake scratch vs user-visible task sessions
 * - last_activity_at: Last activity timestamp in milliseconds
 */
export const taskSessions = sqliteTable(
  "task_sessions",
  {
    session_id: text("session_id").primaryKey(),
    resource_id: text("resource_id").notNull(),
    thread_id: text("thread_id").notNull(),
    parent_id: text("parent_id"),
    workspace_id: text("workspace_id"),
    title: text("title"),
    summary: text("summary", { mode: "json" }).$type<{
      additions?: number;
      deletions?: number;
      files?: number;
      diffs?: number;
    }>(),
    share_url: text("share_url"),
    created_at: integer("created_at", { mode: "timestamp" }).notNull(),
    last_accessed: integer("last_accessed", { mode: "timestamp" }).notNull(),
    status: text("status").notNull().default("researching"),
    spec_type: text("spec_type"),
    session_kind: text("session_kind").notNull().default("task"),
    last_activity_at: integer("last_activity_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  table => ({
    parentSession: foreignKey({
      columns: [table.parent_id],
      foreignColumns: [table.session_id],
      name: "sessions_parent_id_fkey",
    }).onDelete("set null"),
    workspace: foreignKey({
      columns: [table.workspace_id],
      foreignColumns: [workspaces.id],
      name: "sessions_workspace_id_fkey",
    }).onDelete("set null"),
    statusIndex: index("task_sessions_status_idx").on(table.status),
    kindIndex: index("task_sessions_kind_idx").on(table.session_kind),
    workspaceActivityIndex: index("task_sessions_workspace_activity_idx").on(
      table.workspace_id,
      table.last_activity_at
    ),
    workspaceKindActivityIndex: index("task_sessions_workspace_kind_activity_idx").on(
      table.workspace_id,
      table.session_kind,
      table.last_activity_at
    ),
  })
);

/**
 * Tool sessions table - provides per-tool session isolation
 *
 * - tool_session_id: UUIDv7 primary key
 * - session_id: Foreign key to sessions (cascades on delete)
 * - tool_name: Tool identifier (e.g., "sequential-thinking")
 * - tool_key: Optional sub-key for multiple instances of same tool
 * - data: JSON-encoded tool-specific state
 * - created_at: Unix timestamp in milliseconds
 */
export const toolSessions = sqliteTable(
  "tool_sessions",
  {
    tool_session_id: text("tool_session_id").primaryKey(),
    session_id: text("session_id")
      .notNull()
      .references(() => taskSessions.session_id, { onDelete: "cascade" }),
    tool_name: text("tool_name").notNull(),
    tool_key: text("tool_key").notNull(),
    data: text("data", { mode: "json" }).$type<unknown>(),
    created_at: integer("created_at", { mode: "timestamp" }).notNull(),
    last_accessed: integer("last_accessed", { mode: "timestamp" }).notNull(),
  },
  table => ({
    sessionToolKey: uniqueIndex("tool_sessions_session_tool_key").on(
      table.session_id,
      table.tool_name,
      table.tool_key
    ),
  })
);

/**
 * Repo cache table - caches repository metadata
 *
 * - resource_key: Primary key (e.g., "repo:owner/name")
 * - url/ref/search_path: Source metadata
 * - local_path: Local filesystem path
 * - commit_hash: Current commit hash
 * - cloned_at/last_updated: Unix timestamps in milliseconds
 */
export const repoCache = sqliteTable("repo_cache", {
  resource_key: text("resource_key").primaryKey(),
  url: text("url").notNull(),
  ref: text("ref").notNull(),
  search_path: text("search_path").notNull(),
  local_path: text("local_path").notNull(),
  commit_hash: text("commit_hash"),
  cloned_at: integer("cloned_at", { mode: "timestamp" }).notNull(),
  last_updated: integer("last_updated", { mode: "timestamp" }).notNull(),
});

/**
 * Events table - persists server events for catch-up and replay
 *
 * - event_id: UUIDv7 primary key
 * - session_id: Foreign key to sessions (cascades on delete)
 * - sequence: Monotonic sequence number within the session
 * - event_type: Event type (e.g., "message.updated")
 * - properties: JSON-encoded event payload
 * - directory: Optional workspace directory
 * - created_at: Unix timestamp in milliseconds
 *
 * Batch 2: Data Integrity - Added for event persistence and catch-up
 */
export const events = sqliteTable(
  "events",
  {
    event_id: text("event_id").primaryKey(),
    session_id: text("session_id")
      .notNull()
      .references(() => taskSessions.session_id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    event_type: text("event_type").notNull(),
    properties: text("properties", { mode: "json" }).notNull().$type<Record<string, unknown>>(),
    directory: text("directory"),
    created_at: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  table => ({
    sessionSequence: uniqueIndex("events_session_sequence").on(table.session_id, table.sequence),
    sessionCreated: uniqueIndex("events_session_created").on(table.session_id, table.created_at),
  })
);

/**
 * Type definitions for TypeScript
 */
export type TaskSession = typeof taskSessions.$inferSelect;
export type NewTaskSession = typeof taskSessions.$inferInsert;
export type ToolSession = typeof toolSessions.$inferSelect;
export type NewToolSession = typeof toolSessions.$inferInsert;
export type RepoCache = typeof repoCache.$inferSelect;
export type NewRepoCache = typeof repoCache.$inferInsert;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;

/**
 * Threads table - conversation threads for memory system
 *
 * Phase 1 Memory System - stores conversation threads with resourceId for grouping.
 */
export const threads = sqliteTable("threads", {
  id: text("id").primaryKey(),
  resource_id: text("resource_id").notNull(),
  title: text("title").notNull(),
  metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
  created_at: integer("created_at", { mode: "timestamp" }).notNull(),
  updated_at: integer("updated_at", { mode: "timestamp" }).notNull(),
});

/**
 * Messages table - chat messages with three-storage model
 *
 * Three-storage model for non-destructive compaction:
 * - raw_content: Original content - NEVER deleted (for BM25 search)
 * - search_text: What FTS5 indexes (summary + key code for old messages)
 * - injection_text: What gets injected to LLM context
 */
export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  thread_id: text("thread_id")
    .notNull()
    .references(() => threads.id, { onDelete: "cascade" }),
  resource_id: text("resource_id"),
  role: text("role").notNull(),
  raw_content: text("raw_content").notNull(),
  search_text: text("search_text").notNull(),
  injection_text: text("injection_text").notNull(),
  task_id: text("task_id").references(() => tasks.id, { onDelete: "set null" }),
  summary: text("summary"),
  compaction_level: integer("compaction_level").default(0),
  created_at: integer("created_at", { mode: "timestamp" }).notNull(),
  message_index: integer("message_index").notNull(),
  token_count: integer("token_count"),
});

/**
 * Tasks table - task entities for work management
 *
 * Phase 1 Memory System - tasks with dependencies and status tracking.
 */
export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("open"),
  priority: integer("priority").notNull().default(2),
  type: text("type").notNull().default("task"),
  assignee: text("assignee"),
  session_id: text("session_id"),
  created_at: integer("created_at", { mode: "timestamp" }).notNull(),
  updated_at: integer("updated_at", { mode: "timestamp" }).notNull(),
  closed_at: integer("closed_at", { mode: "timestamp" }),
  close_reason: text("close_reason"),
  summary: text("summary"),
  compaction_level: integer("compaction_level").default(0),
  compacted_at: integer("compacted_at", { mode: "timestamp" }),
  original_content: text("original_content"),
  metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>(),
});

/**
 * Task dependencies table - blocking relationships between tasks
 */
export const taskDependencies = sqliteTable(
  "task_dependencies",
  {
    task_id: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    depends_on_id: text("depends_on_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    type: text("type").notNull().default("blocks"),
    created_at: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  table => ({
    pk: primaryKey({ columns: [table.task_id, table.depends_on_id, table.type] }),
  })
);

/**
 * Task messages table - junction table for task-message relationships
 *
 * relation_type: 'output' (generated by task) or 'reference' (user context)
 */
export const taskMessages = sqliteTable(
  "task_messages",
  {
    task_id: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    message_id: text("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    relation_type: text("relation_type").default("output"),
    created_at: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  table => ({
    pk: primaryKey({ columns: [table.task_id, table.message_id] }),
  })
);

/**
 * Type definitions for memory system
 */
export type Thread = typeof threads.$inferSelect;
export type NewThread = typeof threads.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;
export type TaskDependency = typeof taskDependencies.$inferSelect;
export type NewTaskDependency = typeof taskDependencies.$inferInsert;
export type TaskMessage = typeof taskMessages.$inferSelect;
export type NewTaskMessage = typeof taskMessages.$inferInsert;

/**
 * Observational Memory Configuration
 *
 * @ts-expect-error TS2353 - Optional Phase 3 fields may not exist when accessed via optional chaining,
 * but code handles it correctly with default values.
 */
export interface ObservationalMemoryConfig {
  observationThreshold: number;
  reflectionThreshold: number;
  bufferTokens: number;
  bufferActivation: number;
  blockAfter: number;
  scope: "thread" | "resource";
  lastMessages: number;

  // Phase 3 additions
  maxRecentObservations?: number;
  maxRecentHours?: number;
}

/**
 * Buffered Observation Chunk
 */
export interface BufferedObservationChunk {
  content: string;
  messageIds: string[];
  messageTokens: number;
  createdAt: Date;
}

/**
 * Observational Memory table - stores observation state with async buffering support
 *
 * Phase 2 Memory System - Async Buffering & Crash Recovery
 */
export const observationalMemory = sqliteTable("observational_memory", {
  id: text("id").primaryKey(),
  thread_id: text("thread_id"),
  resource_id: text("resource_id"),
  scope: text("scope").notNull().default("thread"),
  lookup_key: text("lookup_key").notNull().unique(),

  // Active observations (narrative)
  active_observations: text("active_observations"),

  // Buffered observations (async)
  buffered_observation_chunks: text("buffered_observation_chunks", { mode: "json" }).$type<
    BufferedObservationChunk[]
  >(),

  // State flags
  is_observing: integer("is_observing").default(0),
  is_reflecting: integer("is_reflecting").default(0),
  is_buffering_observation: integer("is_buffering_observation").default(0),
  is_buffering_reflection: integer("is_buffering_reflection").default(0),

  // Async buffering tracking
  last_buffered_at_tokens: integer("last_buffered_at_tokens"),
  last_buffered_at_time: integer("last_buffered_at_time", { mode: "timestamp" }),

  // Observed message tracking
  observed_message_ids: text("observed_message_ids", { mode: "json" }).$type<string[]>(),

  // Lease-based locking
  lock_owner_id: text("lock_owner_id"),
  lock_expires_at: integer("lock_expires_at", { mode: "timestamp" }),
  lock_operation_id: text("lock_operation_id"),
  last_heartbeat_at: integer("last_heartbeat_at", { mode: "timestamp" }),

  // Configuration (JSON)
  config: text("config", { mode: "json" }).$type<ObservationalMemoryConfig>(),

  // Timestamps
  created_at: integer("created_at", { mode: "timestamp" }).notNull(),
  updated_at: integer("updated_at", { mode: "timestamp" }).notNull(),
  last_observed_at: integer("last_observed_at", { mode: "timestamp" }),

  // Generation tracking for reflections
  generation_count: integer("generation_count").default(0),
});

/**
 * Reflections table - condensed observations from reflector agent
 *
 * Phase 3 Memory System - Reflector & Multi-Level Compaction
 */
export const reflections = sqliteTable("reflections", {
  id: text("id").primaryKey(),
  resource_id: text("resource_id"),
  thread_id: text("thread_id").references(() => threads.id, { onDelete: "cascade" }),

  // Content
  content: text("content").notNull(),
  merged_from: text("merged_from", { mode: "json" }).$type<string[]>(),

  // Generation tracking
  origin_type: text("origin_type").default("reflection"),
  generation_count: integer("generation_count").notNull(),
  token_count: integer("token_count"),

  created_at: integer("created_at", { mode: "timestamp" }).notNull(),
  updated_at: integer("updated_at", { mode: "timestamp" }).notNull(),
});

/**
 * Type definitions for observational memory
 */
export type ObservationalMemory = typeof observationalMemory.$inferSelect;
export type NewObservationalMemory = typeof observationalMemory.$inferInsert;

/**
 * Type definitions for reflections
 */
export type Reflection = typeof reflections.$inferSelect;
export type NewReflection = typeof reflections.$inferInsert;

/**
 * Working Memory table - persistent structured data for project context
 *
 * Phase 4: Working Memory - template-based structured memory for:
 * - Tech stack information
 * - Project structure
 * - User preferences
 * - Current work context
 */
export const workingMemory = sqliteTable("working_memory", {
  id: text("id").primaryKey(),
  resource_id: text("resource_id").notNull(),
  scope: text("scope").notNull().default("resource"),
  content: text("content").notNull(),
  created_at: integer("created_at", { mode: "timestamp" }).notNull(),
  updated_at: integer("updated_at", { mode: "timestamp" }).notNull(),
});

/**
 * Type definitions for working memory
 */
export type WorkingMemory = typeof workingMemory.$inferSelect;
export type NewWorkingMemory = typeof workingMemory.$inferInsert;

/**
 * Project Keypoints table - stores project milestones and highlights
 *
 * Tracks important milestones and achievements across task sessions:
 * - task_session_id: Reference to the task session
 * - task_title: Title of the associated task
 * - milestone: "started" or "completed" - milestone type
 * - completed_at: When this milestone was reached
 * - summary: Narrative summary of the milestone
 * - artifacts: List of relevant artifacts (files, commits, docs)
 * - created_at: When the keypoint was created
 *
 * Dedupe semantics: Latest keypoint per (task_session_id, milestone) wins.
 * Multiple writes to the same milestone will replace previous entries.
 */
export const projectKeypoints = sqliteTable(
  "project_keypoints",
  {
    id: text("id").primaryKey(),
    workspace_id: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    task_session_id: text("task_session_id")
      .notNull()
      .references(() => taskSessions.session_id, { onDelete: "cascade" }),
    task_title: text("task_title").notNull(),
    milestone: text("milestone").notNull(),
    completed_at: integer("completed_at", { mode: "timestamp" }).notNull(),
    summary: text("summary").notNull(),
    artifacts: text("artifacts", { mode: "json" }).$type<string[]>().notNull(),
    created_at: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  table => ({
    workspaceCompletedIdx: index("project_keypoints_workspace_completed_idx").on(
      table.workspace_id,
      table.completed_at
    ),
    taskMilestoneIdx: index("project_keypoints_task_milestone_idx").on(
      table.task_session_id,
      table.milestone
    ),
  })
);

/**
 * Type definitions for project keypoints
 */
export type ProjectKeypoint = typeof projectKeypoints.$inferSelect;
export type NewProjectKeypoint = typeof projectKeypoints.$inferInsert;

/**
 * Type definitions for workspaces
 */
export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
