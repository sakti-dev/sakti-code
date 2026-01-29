/**
 * Sequential Thinking Tool - Database-Backed Session Persistence
 *
 * Provides Drizzle-based persistence for sequential thinking sessions.
 * This file is in the server package to avoid circular dependencies with @ekacode/core.
 *
 * **IMPORTANT:** To use the database-backed version in your agents:
 *
 * ```ts
 * // Import from server package instead of core
 * import { sequentialThinkingDb } from "@ekacode/server/db/sequential-thinking";
 *
 * // Use it like the regular tool
 * const tools = {
 *   sequentialThinking: sequentialThinkingDb
 * };
 * ```
 *
 * **Migration from in-memory to database:**
 * 1. The API is identical - just change the import
 * 2. Sessions now persist across server restarts
 * 3. You must provide sessionId from your agent/orchestration layer
 *
 * Session Pattern: Agent owns sessionId, tool is stateless between calls.
 * This makes the tool pluggable to any orchestration layer (XState, sub-agents, etc).
 */

import { tool, zodSchema } from "ai";
import { z } from "zod";
import { deleteToolSession, getToolSession, updateToolSession } from "./tool-sessions";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * A single thought entry in the session history
 */
type ThoughtEntry = {
  thoughtNumber: number;
  thought: string;
  totalThoughts: number;
  nextThoughtNeeded: boolean;
  isRevision?: boolean;
  revisesThought?: number;
  branchFromThought?: number;
  branchId?: string;
  needsMoreThoughts?: boolean;
  timestamp: number;
};

/**
 * A sequential thinking session stored in database
 */
type DbSession = {
  thoughts: ThoughtEntry[];
  branches: Set<string>;
  createdAt: number;
};

// ============================================================================
// CONSTANTS
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
// DATABASE ADAPTER FUNCTIONS
// ============================================================================

/**
 * Load session from database
 *
 * @param sessionId - The parent session ID
 * @param toolKey - Optional sub-key (defaults to empty string)
 * @returns The session data or null if not found
 */
async function loadSession(sessionId: string, toolKey: string = ""): Promise<DbSession | null> {
  try {
    const toolSession = await getToolSession(sessionId, "sequential-thinking", toolKey);

    if (!toolSession?.data) {
      return null;
    }

    // Parse the JSON data from the database
    const data = toolSession.data as {
      thoughts?: ThoughtEntry[];
      branches?: string[];
      createdAt?: number;
    } | null;

    if (!data) {
      return null;
    }

    return {
      thoughts: data.thoughts || [],
      branches: new Set(data.branches || []),
      createdAt: data.createdAt || Date.now(),
    };
  } catch (_error) {
    // If session doesn't exist or there's an error, return null
    return null;
  }
}

/**
 * Save session to database
 *
 * @param sessionId - The parent session ID
 * @param session - The session data to save
 * @param toolKey - Optional sub-key (defaults to empty string)
 */
async function saveSession(
  sessionId: string,
  session: DbSession,
  toolKey: string = ""
): Promise<void> {
  // Get the tool session to retrieve its ID
  const toolSession = await getToolSession(sessionId, "sequential-thinking", toolKey);

  const data = {
    thoughts: session.thoughts,
    branches: Array.from(session.branches),
    createdAt: session.createdAt,
  };

  await updateToolSession(toolSession.toolSessionId, data);
}

/**
 * Create a new empty session in database
 *
 * @param sessionId - The parent session ID
 * @param toolKey - Optional sub-key (defaults to empty string)
 * @returns The new session data
 */
async function createSession(sessionId: string, toolKey: string = ""): Promise<DbSession> {
  const session: DbSession = {
    thoughts: [],
    branches: new Set(),
    createdAt: Date.now(),
  };

  await saveSession(sessionId, session, toolKey);
  return session;
}

// ============================================================================
// TOOL DEFINITION
// ============================================================================

/**
 * Creates a sequential thinking tool instance with database persistence
 *
 * @param options - Optional configuration
 * @param options.sessionId - Initial session ID for continuation
 * @param options.toolKey - Optional sub-key for multiple sessions per parent
 * @returns AI SDK tool definition
 */
export const createSequentialThinkingToolDb = (
  options: { sessionId?: string; toolKey?: string } = {}
) =>
  tool({
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
7. Only set nextThoughtNeeded to false when truly done
8. **All sessions are persisted to the database and survive server restarts**`,

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
      const toolKey = options.toolKey || "";
      const requestedSessionId = options.sessionId ?? args.sessionId;

      // Clear session if requested
      if (args.clearSession && requestedSessionId) {
        try {
          const toolSession = await getToolSession(
            requestedSessionId,
            "sequential-thinking",
            toolKey
          );
          await deleteToolSession(toolSession.toolSessionId);
        } catch {
          // Session might not exist, ignore error
        }
      }

      // Get or create session from database
      let sessionId = requestedSessionId;
      let session: DbSession;

      const existingSession = await loadSession(sessionId || "", toolKey);

      if (sessionId && existingSession) {
        session = existingSession;
      } else {
        // Create new session
        // Note: In a real scenario, sessionId would be provided by the agent/orchestration layer
        // For now, we use a placeholder if not provided
        if (!sessionId) {
          throw new Error("sessionId must be provided for database-backed sessions");
        }

        session = await createSession(sessionId, toolKey);
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

      // Save session to database
      await saveSession(sessionId, session, toolKey);

      // Generate summary if session is complete
      let summary: string | undefined;
      if (!args.nextThoughtNeeded) {
        summary = `Sequential thinking complete: ${session.thoughts.length} thoughts processed across ${session.branches.size} branches. Session persisted to database.`;
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

/**
 * Default database-backed sequential thinking tool instance
 */
export const sequentialThinkingDb = createSequentialThinkingToolDb();

// ============================================================================
// CLEANUP UTILITIES
// ============================================================================

/**
 * Clear a specific session from database
 *
 * @param sessionId - Session ID to clear
 * @param toolKey - Optional sub-key (defaults to empty string)
 */
export async function clearSession(sessionId: string, toolKey: string = ""): Promise<void> {
  try {
    const toolSession = await getToolSession(sessionId, "sequential-thinking", toolKey);
    await deleteToolSession(toolSession.toolSessionId);
  } catch {
    // Session might not exist, ignore error
  }
}

/**
 * Get a session by ID from database
 *
 * @param sessionId - Session ID to retrieve
 * @param toolKey - Optional sub-key (defaults to empty string)
 * @returns Session if found, undefined otherwise
 */
export async function getSession(
  sessionId: string,
  toolKey: string = ""
): Promise<DbSession | undefined> {
  return (await loadSession(sessionId, toolKey)) || undefined;
}
