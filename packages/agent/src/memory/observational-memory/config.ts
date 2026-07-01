/**
 * Observational Memory config and deps types.
 *
 * The server injects OM resources through {@link ObservationalMemoryDeps},
 * which the engine consumes. Parallel to `CompactionSettings` /
 * `CompactionPrompts` in the compaction module.
 */

import type { Model, ThinkingLevel } from "@sakti-code/llm";
import type { Logger } from "@sakti-code/logger";

import type {
  ObservationalMemoryScope,
  ObservationalMemoryStorage,
} from "../../observational-memory-storage.ts";
import type { SessionStorageShape } from "../../session/storage.ts";
import type { TokenCounter } from "./token-counter.ts";

// ─── Thresholds ──────────────────────────────────────────────────────────────

export interface ObservationalMemoryThresholds {
  /** Run Observer when pending message tokens exceed this (default 30_000). */
  observation: number;
  /** Run Reflector when observationTokenCount exceeds this (default 40_000). */
  reflection: number;
}

// ─── Buffering (Phase D) ─────────────────────────────────────────────────────

/** Async-buffering knobs. Omit/zero => sync-only. */
export interface ObservationalMemoryBuffering {
  /** Ratio of messageTokens to buffer at (e.g. 0.2). */
  observationBufferTokens: number;
  /** Activation ratio for swapBufferedToActive (e.g. 0.8). */
  observationBufferActivation: number;
  /** Activation ratio for swapBufferedReflectionToActive (e.g. 0.5). */
  reflectionBufferActivation: number;
}

// ─── Deps ────────────────────────────────────────────────────────────────────

export interface ObservationalMemoryDeps {
  readonly storage: ObservationalMemoryStorage;
  readonly sessionId: string;
  readonly projectId: string;
  /**
   * Lookup scope: 'thread' = one record per session (default);
   * 'resource' = one record per project, shared across all sessions in it
   * (stored with threadId=null, keyed by resource:{projectId}).
   */
  readonly scope: ObservationalMemoryScope;
  readonly observeModel: Model;
  readonly observeApiKey: string;
  readonly observeThinkingLevel?: ThinkingLevel | undefined;
  readonly reflectModel: Model;
  readonly reflectApiKey: string;
  readonly reflectThinkingLevel?: ThinkingLevel | undefined;
  readonly thresholds: ObservationalMemoryThresholds;
  readonly buffering?: ObservationalMemoryBuffering | undefined;
  readonly tokenCounter: TokenCounter;
  readonly sessionStorage: SessionStorageShape;
  /** Structured logger for best-effort failure reporting. Optional. */
  readonly logger?: Logger | undefined;
  /** Custom observer/reflector instruction overlay (e.g. caveman). Optional. */
  readonly instruction?: string | undefined;
}

// ─── Options (server-facing toggle) ──────────────────────────────────────────

export interface ObservationalMemoryOptions {
  readonly enabled: boolean;
  readonly deps: ObservationalMemoryDeps;
}
