/**
 * Sequential Thinking Storage Adapter
 *
 * Abstract storage interface for sequential thinking sessions.
 * Supports both in-memory and database-backed implementations.
 *
 * This pattern allows the core tool to remain database-agnostic
 * while enabling persistent storage in production.
 */

import { shutdown } from "@ekacode/shared/shutdown";
import { v7 as uuidv7 } from "uuid";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * A single thought entry in the session history
 */
export type ThoughtEntry = {
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
 * A sequential thinking session
 */
export type Session = {
  id: string;
  createdAt: number;
  lastAccessed?: number;
  thoughts: ThoughtEntry[];
  branches: Set<string>;
};

/**
 * Serialized session format for storage (uses array instead of Set for JSON compatibility)
 */
export type SessionSerialized = {
  id: string;
  createdAt: number;
  lastAccessed: number;
  thoughts: ThoughtEntry[];
  branches: string[];
};

// ============================================================================
// STORAGE INTERFACE
// ============================================================================

/**
 * Storage interface for sequential thinking sessions
 */
export interface SequentialThinkingStorage {
  /**
   * Get a session by ID
   */
  get(sessionId: string): Session | Promise<Session | undefined>;

  /**
   * Save a session (create or update)
   */
  save(session: Session): void | Promise<void>;

  /**
   * Delete a session
   */
  delete(sessionId: string): void | Promise<void>;

  /**
   * List all session IDs
   */
  list?(): string[] | Promise<string[]>;

  /**
   * Clear all sessions
   */
  clear?(): void | Promise<void>;
}

// ============================================================================
// IN-MEMORY STORAGE IMPLEMENTATION
// ============================================================================

/**
 * In-memory storage implementation (default for development)
 */
export class MemoryStorage implements SequentialThinkingStorage {
  private sessions: Map<string, Session> = new Map();
  private ttlMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(ttlMs: number = 30 * 60 * 1000) {
    this.ttlMs = ttlMs;
    this.startCleanup();
  }

  async get(sessionId: string): Promise<Session | undefined> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastAccessed = Date.now();
    }
    return session;
  }

  async save(session: Session): Promise<void> {
    session.lastAccessed = Date.now();
    this.sessions.set(session.id, session);
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async list(): Promise<string[]> {
    return Array.from(this.sessions.keys());
  }

  async clear(): Promise<void> {
    this.sessions.clear();
  }

  private startCleanup(): void {
    if (typeof clearInterval === "undefined" || typeof setInterval === "undefined") {
      return;
    }

    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      const entries = Array.from(this.sessions.entries());
      for (const [id, session] of entries) {
        const age = now - session.createdAt;
        const lastAccessAge = session.lastAccessed ? now - session.lastAccessed : age;
        if (lastAccessAge > this.ttlMs) {
          this.sessions.delete(id);
        }
      }
    }, this.ttlMs);

    // Register cleanup handler with centralized shutdown manager
    shutdown.register("sequential-thinking-storage", () => this.stopCleanup());
  }

  stopCleanup(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

// ============================================================================
// SERIALIZATION UTILITIES
// ============================================================================

/**
 * Serialize a session to JSON-compatible format
 */
export function serializeSession(session: Session): SessionSerialized {
  return {
    id: session.id,
    createdAt: session.createdAt,
    lastAccessed: session.lastAccessed ?? Date.now(),
    thoughts: session.thoughts,
    branches: Array.from(session.branches),
  };
}

/**
 * Deserialize a session from JSON format
 */
export function deserializeSession(data: SessionSerialized): Session {
  return {
    id: data.id,
    createdAt: data.createdAt,
    lastAccessed: data.lastAccessed,
    thoughts: data.thoughts,
    branches: new Set(data.branches),
  };
}

/**
 * Create a new session with defaults
 */
export function createSession(sessionId?: string): Session {
  return {
    id: sessionId ?? uuidv7(),
    createdAt: Date.now(),
    lastAccessed: Date.now(),
    thoughts: [],
    branches: new Set(),
  };
}

// ============================================================================
// DATABASE STORAGE ADAPTER (for server package)
// ============================================================================

/**
 * Helper to create a database-backed storage adapter
 *
 * This factory function allows the server package to create a storage
 * implementation that uses Drizzle and the tool_sessions table.
 *
 * @param db - Drizzle database instance
 * @param toolSessions - Tool sessions table schema
 * @returns Storage adapter instance
 */
export interface DatabaseStorageConfig {
  getToolSession(sessionId: string): Promise<SessionSerialized | null>;
  saveToolSession(session: SessionSerialized): Promise<void>;
  deleteToolSession(sessionId: string): Promise<void>;
  listToolSessions?(): Promise<string[]>;
  clearToolSessions?(): Promise<void>;
}

/**
 * Create a database-backed storage adapter
 *
 * Usage in server package:
 * ```ts
 * import { createDatabaseStorage } from "@ekacode/core/tools/sequential-thinking-storage";
 * import { db, toolSessions } from "@ekacode/server/db";
 * import { eq, and } from "drizzle-orm";
 *
 * const storage = createDatabaseStorage({
 *   getToolSession: async (sessionId) => {
 *     const result = await db
 *       .select()
 *       .from(toolSessions)
 *       .where(
 *         and(
 *           eq(toolSessions.session_id, sessionId),
 *           eq(toolSessions.tool_name, "sequential-thinking"),
 *           eq(toolSessions.tool_key, "default")
 *         )
 *       )
 *       .get();
 *     return result?.data as SessionSerialized | null;
 *   },
 *   saveToolSession: async (session) => {
 *     await db.insert(toolSessions).values({
 *       tool_session_id: uuidv7(),
 *       session_id: session.id,
 *       tool_name: "sequential-thinking",
 *       tool_key: "default",
 *       data: session,
 *       created_at: new Date(session.createdAt),
 *       last_accessed: new Date(session.lastAccessed),
 *     }).onConflictDoUpdate(...);
 *   },
 *   deleteToolSession: async (sessionId) => {
 *     await db.delete(toolSessions).where(...);
 *   },
 * });
 * ```
 */
export function createDatabaseStorage(config: DatabaseStorageConfig): SequentialThinkingStorage {
  return {
    async get(sessionId: string): Promise<Session | undefined> {
      const data = await config.getToolSession(sessionId);
      return data ? deserializeSession(data) : undefined;
    },

    async save(session: Session): Promise<void> {
      const serialized = serializeSession(session);
      await config.saveToolSession(serialized);
    },

    async delete(sessionId: string): Promise<void> {
      await config.deleteToolSession(sessionId);
    },

    async list(): Promise<string[]> {
      return config.listToolSessions?.() ?? [];
    },

    async clear(): Promise<void> {
      await config.clearToolSessions?.();
    },
  };
}
