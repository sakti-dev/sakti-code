/**
 * Session Store for search-docs tool
 *
 * Manages cloned repositories AND sub-agent sessions with LRU + TTL cleanup.
 */

import { v7 as uuidv7 } from "uuid";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * A cloned repository with metadata
 */
export type ClonedRepo = {
  resourceKey: string;
  url: string;
  branch: string;
  localPath: string;
  clonedAt: number;
  lastUpdated: number;
  searchPaths: string[];
  metadata: {
    commit?: string;
  };
};

/**
 * A search-docs session containing repos and sub-agent mappings
 */
export type DocSession = {
  id: string;
  createdAt: number;
  lastAccessed: number;
  repos: Map<string, ClonedRepo>;
  subAgentIdsByRepo: Map<string, string>;
  subAgentConversation?: unknown[];
};

// ============================================================================
// SESSION STORE IMPLEMENTATION
// ============================================================================

const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_MAX_SESSIONS = 100;

let sessionStoreInstance: SessionStore | null = null;

export class SessionStore {
  private sessions: Map<string, DocSession>;
  private sessionTTL: number;
  private maxSessions: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null;

  constructor(options: { sessionTTL?: number; maxSessions?: number } = {}) {
    this.sessions = new Map();
    this.sessionTTL = options.sessionTTL ?? DEFAULT_SESSION_TTL_MS;
    this.maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this.cleanupTimer = null;

    // Start periodic cleanup
    this.startCleanup();
  }

  /**
   * Get or create a session
   */
  getOrCreateSession(sessionId?: string): DocSession {
    const now = Date.now();

    if (sessionId && this.sessions.has(sessionId)) {
      const session = this.sessions.get(sessionId)!;
      session.lastAccessed = now;
      return session;
    }

    const newSession: DocSession = {
      id: sessionId || uuidv7(),
      createdAt: now,
      lastAccessed: now,
      repos: new Map(),
      subAgentIdsByRepo: new Map(),
    };

    // Enforce max sessions limit with LRU eviction
    if (this.sessions.size >= this.maxSessions) {
      this.evictLeastRecentlyUsed();
    }

    this.sessions.set(newSession.id, newSession);
    return newSession;
  }

  /**
   * Get a session by ID
   */
  getSession(sessionId: string): DocSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Check if a session exists
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Update session's lastAccessed time
   */
  touchSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastAccessed = Date.now();
    }
  }

  /**
   * Delete a specific session
   */
  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * Clear all sessions
   */
  clearAllSessions(): void {
    this.sessions.clear();
  }

  /**
   * Get the number of active sessions
   */
  getSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Set the maximum number of sessions
   */
  setMaxSessions(max: number): void {
    this.maxSessions = max;
  }

  /**
   * Add a cloned repo to a session
   */
  addRepo(sessionId: string, repo: ClonedRepo): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.repos.set(repo.resourceKey, repo);
    }
  }

  /**
   * Get a repo from a session
   */
  getRepo(sessionId: string, resourceKey: string): ClonedRepo | undefined {
    const session = this.sessions.get(sessionId);
    return session?.repos.get(resourceKey);
  }

  /**
   * Check if a session has a specific repo
   */
  hasRepo(sessionId: string, resourceKey: string): boolean {
    const session = this.sessions.get(sessionId);
    return session?.repos.has(resourceKey) ?? false;
  }

  /**
   * Store sub-agent ID for a repo
   */
  setSubAgent(sessionId: string, resourceKey: string, subAgentId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.subAgentIdsByRepo.set(resourceKey, subAgentId);
    }
  }

  /**
   * Get sub-agent ID for a repo
   */
  getSubAgent(sessionId: string, resourceKey: string): string | undefined {
    const session = this.sessions.get(sessionId);
    return session?.subAgentIdsByRepo.get(resourceKey);
  }

  /**
   * Remove expired sessions based on TTL
   */
  cleanupExpired(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions.entries()) {
      if (now - session.createdAt > this.sessionTTL) {
        this.sessions.delete(id);
      }
    }
  }

  /**
   * Evict the least recently used session
   */
  private evictLeastRecentlyUsed(): void {
    let oldestId: string | null = null;
    let oldestTime = Infinity;

    for (const [id, session] of this.sessions.entries()) {
      if (session.lastAccessed < oldestTime) {
        oldestTime = session.lastAccessed;
        oldestId = id;
      }
    }

    if (oldestId) {
      this.sessions.delete(oldestId);
    }
  }

  /**
   * Start periodic cleanup timer
   */
  private startCleanup(): void {
    if (typeof clearInterval !== "undefined" && typeof setInterval !== "undefined") {
      this.cleanupTimer = setInterval(() => {
        this.cleanupExpired();
      }, this.sessionTTL);

      // Register cleanup handlers for graceful shutdown
      if (typeof process !== "undefined") {
        const shutdownHandler = () => {
          this.stopCleanup();
        };
        process.on("beforeExit", shutdownHandler);
        process.on("SIGINT", shutdownHandler);
        process.on("SIGTERM", shutdownHandler);
      }
    }
  }

  /**
   * Stop the cleanup timer
   */
  stopCleanup(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

/**
 * Get the singleton session store instance
 */
export function getSessionStore(): SessionStore {
  if (!sessionStoreInstance) {
    sessionStoreInstance = new SessionStore();
  }
  return sessionStoreInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetSessionStore(): void {
  if (sessionStoreInstance) {
    sessionStoreInstance.stopCleanup();
    sessionStoreInstance = null;
  }
}

// ============================================================================
// CONVENIENCE EXPORTS (singleton methods)
// ============================================================================

const store = getSessionStore();

export const sessionStore = {
  getOrCreateSession: (sessionId?: string) => store.getOrCreateSession(sessionId),
  getSession: (sessionId: string) => store.getSession(sessionId),
  hasSession: (sessionId: string) => store.hasSession(sessionId),
  touchSession: (sessionId: string) => store.touchSession(sessionId),
  deleteSession: (sessionId: string) => store.deleteSession(sessionId),
  clearAllSessions: () => store.clearAllSessions(),
  getSessionCount: () => store.getSessionCount(),
  setMaxSessions: (max: number) => store.setMaxSessions(max),
  addRepo: (sessionId: string, repo: ClonedRepo) => store.addRepo(sessionId, repo),
  getRepo: (sessionId: string, resourceKey: string) => store.getRepo(sessionId, resourceKey),
  hasRepo: (sessionId: string, resourceKey: string) => store.hasRepo(sessionId, resourceKey),
  setSubAgent: (sessionId: string, resourceKey: string, subAgentId: string) =>
    store.setSubAgent(sessionId, resourceKey, subAgentId),
  getSubAgent: (sessionId: string, resourceKey: string) =>
    store.getSubAgent(sessionId, resourceKey),
  cleanupExpired: () => store.cleanupExpired(),
};

/**
 * Clear all sessions (alias for testing)
 */
export function clearAllSessions(): void {
  store.clearAllSessions();
}

/**
 * Reset the singleton and create a new instance (for testing)
 */
export function clearAllSessionsAndReset(): void {
  resetSessionStore();
  clearAllSessions();
}
