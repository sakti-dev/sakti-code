import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  cwd: text("cwd").notNull().unique(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id),
  title: text("title"),
  modelId: text("model_id").notNull(),
  thinkingLevel: text("thinking_level").notNull().default("off"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => sessions.id),
  role: text("role").notNull(),
  content: text("content").notNull(),
  toolCalls: text("tool_calls"),
  toolCallId: text("tool_call_id"),
  toolName: text("tool_name"),
  toolArguments: text("tool_arguments"),
  isError: integer("is_error"),
  usage: text("usage"),
  createdAt: integer("created_at").notNull(),
});

export const toolExecutions = sqliteTable("tool_executions", {
  id: text("id").primaryKey(),
  messageId: text("message_id").notNull().references(() => messages.id),
  sessionId: text("session_id").notNull().references(() => sessions.id),
  toolName: text("tool_name").notNull(),
  arguments: text("arguments").notNull(),
  result: text("result"),
  durationMs: integer("duration_ms"),
  createdAt: integer("created_at").notNull(),
});

export const costs = sqliteTable("costs", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => sessions.id),
  projectId: text("project_id").notNull().references(() => projects.id),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  costUsd: real("cost_usd").notNull(),
  modelId: text("model_id").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const modelConfigs = sqliteTable("model_configs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").references(() => projects.id),
  provider: text("provider").notNull(),
  modelId: text("model_id").notNull(),
  thinkingLevel: text("thinking_level").notNull().default("off"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
