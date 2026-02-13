/**
 * Agent types for opencode-style architecture
 *
 * These types define the core interfaces for agent execution,
 * replacing the XState-based actor pattern with simple class-based
 * agent implementation.
 */

import { z } from "zod";

/**
 * Agent type enumeration
 */
export const AgentType = z.enum(["explore", "plan", "build"]);
export type AgentType = z.infer<typeof AgentType>;

/**
 * Agent configuration schema
 */
export const AgentConfig = z.object({
  id: z.string(),
  type: AgentType,
  model: z.string(),
  systemPrompt: z.string(),
  tools: z.record(z.string(), z.any()), // Tools as object with named keys (AI SDK format)
  maxIterations: z.number().default(50),
  temperature: z.number().optional(),
});
export type AgentConfig = z.infer<typeof AgentConfig>;

/**
 * Agent result schema
 */
export const AgentResult = z.object({
  agentId: z.string(),
  type: AgentType,
  status: z.enum(["completed", "failed", "stopped"]),
  messages: z.array(z.any()), // CoreMessage[]
  finalContent: z.string().optional(),
  error: z.string().optional(),
  iterations: z.number(),
  duration: z.number(), // milliseconds
});
export type AgentResult = z.infer<typeof AgentResult>;

/**
 * Agent input schema
 */
export const AgentInput = z.object({
  task: z.string(),
  context: z.record(z.string(), z.any()).optional(),
  previousResults: z.array(AgentResult).optional(),
});
export type AgentInput = z.infer<typeof AgentInput>;

/**
 * Event types for streaming
 *
 * Includes reasoning events for AI SDK extended thinking support
 * (used by models like Claude 3.5 with thinking, GPT-o1, etc.)
 */
export const AgentEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string(), agentId: z.string() }),
  z.object({
    type: z.literal("tool-call"),
    toolCallId: z.string(),
    toolName: z.string(),
    args: z.any(),
    agentId: z.string(),
  }),
  z.object({
    type: z.literal("tool-result"),
    toolCallId: z.string(),
    toolName: z.string(),
    result: z.any(),
    agentId: z.string(),
  }),
  z.object({ type: z.literal("finish"), finishReason: z.string(), agentId: z.string() }),
  z.object({ type: z.literal("error"), error: z.string(), agentId: z.string() }),
  z.object({
    type: z.literal("step-start"),
    stepId: z.string(),
    snapshot: z.string().optional(),
    agentId: z.string(),
  }),
  z.object({
    type: z.literal("step-finish"),
    stepId: z.string(),
    reason: z.string(),
    snapshot: z.string().optional(),
    cost: z.number(),
    tokens: z.object({
      input: z.number(),
      output: z.number(),
      reasoning: z.number(),
      cache: z.object({
        read: z.number(),
        write: z.number(),
      }),
    }),
    agentId: z.string(),
  }),
  z.object({
    type: z.literal("snapshot"),
    snapshot: z.string(),
    stepId: z.string().optional(),
    agentId: z.string(),
  }),
  z.object({
    type: z.literal("patch"),
    hash: z.string(),
    files: z.string().array(),
    stepId: z.string().optional(),
    agentId: z.string(),
  }),
  // Reasoning events (from AI SDK fullStream for extended thinking models)
  z.object({
    type: z.literal("reasoning-start"),
    reasoningId: z.string(),
    agentId: z.string(),
  }),
  z.object({
    type: z.literal("reasoning-delta"),
    reasoningId: z.string(),
    text: z.string(),
    agentId: z.string(),
  }),
  z.object({
    type: z.literal("reasoning-end"),
    reasoningId: z.string(),
    durationMs: z.number(),
    agentId: z.string(),
  }),
  z.object({
    type: z.literal("retry"),
    attempt: z.number(),
    message: z.string(),
    next: z.number(),
    errorKind: z.string().optional(),
    agentId: z.string(),
  }),
]);
export type AgentEvent = z.infer<typeof AgentEvent>;
