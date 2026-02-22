/**
 * Sequential Thinking Tool - Native AI SDK v6 Implementation
 *
 * Provides multi-turn reasoning capability for AI agents with support for
 * revision, branching, and iterative refinement.
 *
 * **Storage Pattern:**
 * - Default: In-memory storage (ephemeral, for development/testing)
 * - Production: Database-backed storage via storage adapter (persists across restarts)
 *
 * Session Pattern: Agent owns sessionId, tool is stateless between calls.
 * This makes the tool pluggable to any orchestration layer (XState, sub-agents, etc).
 *
 * **Usage:**
 * ```ts
 * // In-memory storage (default)
 * import { sequentialThinking } from "@sakti-code/core/tools";
 *
 * // Database-backed storage (production)
 * import { sequentialThinking } from "@sakti-code/core/tools";
 * import { createDatabaseStorage } from "@sakti-code/core/tools/sequential-thinking-storage";
 * import { getDb, toolSessions } from "../server-bridge";
 *
 * const storage = createDatabaseStorage({
 *   getToolSession: async (sessionId) => { ... },
 *   saveToolSession: async (session) => { ... },
 *   deleteToolSession: async (sessionId) => { ... },
 * });
 *
 * const tool = createSequentialThinkingTool({ storage });
 * ```
 */

import { tool, zodSchema } from "ai";
import { z } from "zod";

// Import types and storage utilities
import {
  type SequentialThinkingStorage,
  type Session,
  type SessionSerialized,
  type ThoughtEntry,
  MemoryStorage,
  createDatabaseStorage,
  createSession,
  deserializeSession,
  serializeSession,
} from "./sequential-thinking-storage";

// Re-export types for external use
export {
  MemoryStorage,
  createDatabaseStorage,
  createSession,
  deserializeSession,
  serializeSession,
};
export type { SequentialThinkingStorage, Session, SessionSerialized, ThoughtEntry };

// ============================================================================
// CONFIGURATION
// ============================================================================

// Session limits for defensive programming
const MAX_THOUGHTS_PER_SESSION = 1000;
const MAX_THOUGHT_LENGTH = 50000;

// ============================================================================
// OUTPUT SCHEMA
// ============================================================================

const sequentialThinkingOutputSchema = z.object({
  sessionId: z.string().describe("Session ID for next call"),
  thoughtNumber: z.number(),
  totalThoughts: z.number(),
  nextThoughtNeeded: z.boolean(),
  thoughtHistory: z
    .array(
      z.object({
        thoughtNumber: z.number(),
        thought: z.string(),
        isRevision: z.boolean().optional(),
      })
    )
    .describe("Full thought history for context"),
  branches: z.array(z.string()).describe("Active branch IDs"),
  thoughtHistoryLength: z.number().describe("Total thoughts in session"),
  summary: z.string().optional().describe("Optional summary of thinking so far"),
});

// ============================================================================
// TOOL DEFINITION
// ============================================================================

/**
 * Options for creating a sequential thinking tool
 */
export interface CreateSequentialThinkingToolOptions {
  /**
   * Initial session ID for continuation
   */
  sessionId?: string;

  /**
   * Storage adapter (defaults to in-memory)
   */
  storage?: SequentialThinkingStorage;
}

/**
 * Creates a sequential thinking tool instance
 *
 * @param options - Optional configuration
 * @returns AI SDK tool definition
 */
export const createSequentialThinkingTool = (options: CreateSequentialThinkingToolOptions = {}) => {
  // Use provided storage or default to in-memory
  const storage = options.storage ?? new MemoryStorage();

  return tool({
    description: `A detailed tool for dynamic and reflective problem-solving through thoughts.
This tool helps analyze problems through a flexible thinking process that can adapt and evolve.
Each thought can build on, question, or revise previous insights as understanding deepens.

When to use this tool:
- Breaking down complex problems into steps
- Planning and design with room for revision
- Analysis that might need course correction
- Problems where the full scope might not be clear initially
- Problems that require a multi-step solution
- Tasks that need to maintain context over multiple steps
- Situations where irrelevant information needs to be filtered out

Key features:
- You can adjust totalThoughts up or down as you progress
- You can question or revise previous thoughts
- You can add more thoughts even after reaching what seemed like the end
- You can express uncertainty and explore alternative approaches
- Not every thought needs to build linearly - you can branch or backtrack

Parameters explained:
- thought: Your current thinking step
- nextThoughtNeeded: True if you need more thinking
- thoughtNumber: Current number in sequence (can go beyond initial total)
- totalThoughts: Current estimate (can be adjusted up/down)
- sessionId: Pass existing session ID to continue, or omit for new session
- isRevision, revisesThought, branchFromThought, branchId: Optional branching/revision
- clearSession: Set true to reset and start fresh

You should:
1. Start with an initial estimate of needed thoughts, but be ready to adjust
2. Feel free to question or revise previous thoughts
3. Don't hesitate to add more thoughts if needed, even at the "end"
4. Express uncertainty when present
5. Mark thoughts that revise previous thinking or branch into new paths
6. Ignore information that is irrelevant to the current step
7. Only set nextThoughtNeeded to false when truly done`,

    inputSchema: zodSchema(
      z.object({
        thought: z.string().describe("Your current thinking step"),
        nextThoughtNeeded: z.boolean().describe("Whether another thought step is needed"),
        thoughtNumber: z.number().int().min(1).describe("Current thought number (e.g., 1, 2, 3)"),
        totalThoughts: z
          .number()
          .int()
          .min(1)
          .describe("Estimated total thoughts needed (e.g., 5, 10)"),
        sessionId: z
          .string()
          .optional()
          .describe("Pass existing session ID to continue, or omit for new session"),
        isRevision: z.boolean().optional().describe("Whether this revises previous thinking"),
        revisesThought: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Which thought number is being reconsidered"),
        branchFromThought: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe("Branching point thought number"),
        branchId: z.string().optional().describe("Branch identifier"),
        needsMoreThoughts: z.boolean().optional().describe("If more thoughts are needed"),
        clearSession: z.boolean().optional().describe("Set true to reset and start fresh"),
      })
    ),

    outputSchema: zodSchema(sequentialThinkingOutputSchema),

    execute: async args => {
      const requestedSessionId = options.sessionId ?? args.sessionId;

      // Clear session if requested
      if (args.clearSession && requestedSessionId) {
        await storage.delete(requestedSessionId);
      }

      // Get or create session
      let sessionId: string;
      let session: Session;

      // Try to get existing session, but only if we're not clearing
      const existingSession = args.clearSession
        ? undefined
        : await storage.get(requestedSessionId ?? "");

      if (requestedSessionId && existingSession) {
        // Use existing session
        sessionId = existingSession.id;
        session = existingSession;
      } else {
        // Generate new session (always use UUIDv7)
        session = createSession(undefined); // Always generate UUIDv7
        sessionId = session.id;
        await storage.save(session);
      }

      // Validate session limits (defensive programming)
      if (session.thoughts.length >= MAX_THOUGHTS_PER_SESSION) {
        throw new Error(`Session exceeds maximum thoughts limit: ${MAX_THOUGHTS_PER_SESSION}`);
      }
      if (args.thought.length > MAX_THOUGHT_LENGTH) {
        throw new Error(`Thought exceeds maximum length: ${MAX_THOUGHT_LENGTH} characters`);
      }

      // Track branches
      if (args.branchId && !session.branches.has(args.branchId)) {
        session.branches.add(args.branchId);
      }

      // Add thought to history
      const thoughtEntry: ThoughtEntry = {
        thoughtNumber: args.thoughtNumber,
        thought: args.thought,
        totalThoughts: args.totalThoughts,
        nextThoughtNeeded: args.nextThoughtNeeded,
        isRevision: args.isRevision,
        revisesThought: args.revisesThought,
        branchFromThought: args.branchFromThought,
        branchId: args.branchId,
        needsMoreThoughts: args.needsMoreThoughts,
        timestamp: Date.now(),
      };
      session.thoughts.push(thoughtEntry);

      // Save updated session
      await storage.save(session);

      // Generate summary if session is complete
      let summary: string | undefined;
      if (!args.nextThoughtNeeded) {
        summary = `Sequential thinking complete: ${session.thoughts.length} thoughts processed across ${session.branches.size} branches.`;
      }

      // Return session state + history for LLM context
      return sequentialThinkingOutputSchema.parse({
        sessionId,
        thoughtNumber: args.thoughtNumber,
        totalThoughts: args.totalThoughts,
        nextThoughtNeeded: args.nextThoughtNeeded,
        thoughtHistory: session.thoughts.map(t => ({
          thoughtNumber: t.thoughtNumber,
          thought: t.thought,
          isRevision: t.isRevision,
        })),
        branches: Array.from(session.branches),
        thoughtHistoryLength: session.thoughts.length,
        summary,
      });
    },
  });
};

/**
 * Default sequential thinking tool instance (in-memory storage)
 */
export const sequentialThinking = createSequentialThinkingTool();

// ============================================================================
// STORAGE FACTORY FOR SERVER PACKAGE
// ============================================================================

/**
 * Create a database-backed sequential thinking tool
 *
 * This is a convenience factory for the server package to create
 * a tool instance that persists sessions to the database.
 *
 * @param config - Database storage configuration
 * @returns Tool instance with database backing
 *
 * @example
 * ```ts
 * import { createSequentialThinkingToolWithDb } from "@sakti-code/core/tools";
 * import { getDb, toolSessions } from "../server-bridge";
 * import { eq, and } from "drizzle-orm";
 * import { v7 as uuidv7 } from "uuid";
 *
 * const tool = createSequentialThinkingToolWithDb({
 *   db,
 *   getToolSession: async (sessionId) => {
 *     const result = await db.select().from(toolSessions)
 *       .where(and(
 *         eq(toolSessions.session_id, sessionId),
 *         eq(toolSessions.tool_name, "sequential-thinking"),
 *         eq(toolSessions.tool_key, "default")
 *       )).get();
 *     return result?.data as SessionSerialized | null;
 *   },
 *   saveToolSession: async (session) => {
 *     // Insert or update logic
 *   },
 *   deleteToolSession: async (sessionId) => {
 *     await db.delete(toolSessions).where(...);
 *   },
 * });
 * ```
 */
export interface DatabaseStorageConfig {
  getToolSession(sessionId: string): Promise<SessionSerialized | null>;
  saveToolSession(session: SessionSerialized): Promise<void>;
  deleteToolSession(sessionId: string): Promise<void>;
  listToolSessions?(): Promise<string[]>;
  clearToolSessions?(): Promise<void>;
}

export function createSequentialThinkingToolWithDb(
  config: DatabaseStorageConfig,
  options?: Omit<CreateSequentialThinkingToolOptions, "storage">
) {
  const storage = createDatabaseStorage
    ? createDatabaseStorage(config)
    : // Fallback if createDatabaseStorage not imported (circular dependency check)
      ({
        async get(sessionId: string) {
          const data = await config.getToolSession(sessionId);
          return data ? deserializeSession(data) : undefined;
        },
        async save(session: Session) {
          await config.saveToolSession(serializeSession(session));
        },
        async delete(sessionId: string) {
          await config.deleteToolSession(sessionId);
        },
        async list() {
          return config.listToolSessions?.() ?? [];
        },
        async clear() {
          await config.clearToolSessions?.();
        },
      } satisfies SequentialThinkingStorage);

  return createSequentialThinkingTool({ ...options, storage });
}
