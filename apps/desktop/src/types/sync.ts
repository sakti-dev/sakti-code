/**
 * Shared Sync Types
 *
 * Types extracted from GlobalSyncProvider for use across components.
 * Part of Phase 6: Cleanup & Optimization
 */

/**
 * Session types
 */
export interface Session {
  sessionId: string;
  resourceId: string;
  threadId?: string;
  createdAt: number;
  lastAccessed: number;
}

export interface Message {
  info:
    | { role: "user"; id: string; sessionID?: string; time?: { created: number } }
    | {
        role: "assistant";
        id: string;
        parentID?: string;
        model?: string;
        provider?: string;
        sessionID?: string;
        time?: { created: number; completed?: number };
      }
    | { role: "system"; id: string };
  parts: Part[];
  createdAt?: number;
  updatedAt?: number;
}

export interface Part {
  id: string;
  sessionID: string;
  messageID: string;
  type: string;
  text?: string;
  [key: string]: unknown;
}

export interface SessionStatus {
  status:
    | { type: "idle" }
    | { type: "busy" }
    | { type: "retry"; attempt: number; message: string; next: number };
}

export interface PermissionRequest {
  id: string;
  sessionID: string;
  permission: string;
  patterns: string[];
  tool?: {
    messageID: string;
    callID: string;
  };
}

export interface QuestionRequest {
  id: string;
  sessionID: string;
  questions: unknown[];
  tool?: {
    messageID: string;
    callID: string;
  };
}

/**
 * Directory store state
 */
export interface DirectoryStore {
  ready: boolean;
  session: Session[];
  message: Record<string, Message[]>;
  part: Record<string, Part[]>;
  sessionStatus: Record<string, SessionStatus>;
  permission: Record<string, PermissionRequest[]>;
  question: Record<string, QuestionRequest[]>;
  limit: number;
}

/**
 * Store updater function - path-based SetStoreFunction for granular updates
 *
 * Supports:
 * - (partial: T) => void - full partial update
 * - <U>(name: string, value: U) => void - single key update
 * - <K1 extends keyof T>(k1: K1, value: T[K1]) => void - one-level path update
 * - <K1 extends keyof T, K2 extends keyof T[K1]>(k1: K1, k2: K2, value: T[K1][K2]) => void - two-level path update
 * - <K1 extends keyof T, K2 extends keyof T[K1], K3 extends keyof T[K1][K2]>(k1: K1, k2: K2, k3: K3, value: T[K1][K2][K3]) => void - three-level path update
 */
export type StoreUpdater<T> = {
  (partial: T): void;
  <U>(name: string, value: U): void;
  <K1 extends keyof T>(k1: K1, value: T[K1]): void;
  <K1 extends keyof T, K2 extends keyof T[K1]>(k1: K1, k2: K2, value: T[K1][K2]): void;
  <K1 extends keyof T, K2 extends keyof T[K1], K3 extends keyof T[K1][K2]>(
    k1: K1,
    k2: K2,
    k3: K3,
    value: T[K1][K2][K3]
  ): void;
};
