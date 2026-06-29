import { readFile as readFileAsync } from "node:fs/promises";
import type { AssistantMessage, Model } from "@sakti-code/llm";
import type { Logger } from "@sakti-code/logger";
import { Effect, Fiber, Stream } from "effect";
import type { AgentHarness } from "../agent/agent-harness.ts";
import {
  checkCompaction,
  runAutoCompactionEffect,
} from "../compaction/auto-compaction.ts";
import type { CompactionSettings } from "../compaction/compaction.ts";
import {
  executeWithRetryEffect,
  type RetryRunnerDepsEffect,
  type RetrySettings,
  type StuckGuardState,
} from "../compaction/retry-loop.ts";
import type {
  AgentHarnessEvent,
  PromptTemplate,
  Skill,
  ThinkingLevel,
} from "../harness-types.ts";
import {
  planFirstTurn,
  type ReadFile,
} from "../resources/prompt-preprocessor.ts";
import type { SessionShape } from "../session/session.ts";
import type { SessionStorageShape } from "../session/storage.ts";

const PROMPT_ARG_SPLIT = /\s+/;

export interface AgentRunDeps {
  readonly apiKey: string;
  readonly compactionSettings: CompactionSettings;
  readonly cwd: string;

  readonly emit: (event: AgentHarnessEvent) => void;
  readonly harness: AgentHarness;

  readonly loadStuckGuard: () => Effect.Effect<StuckGuardState, Error>;

  readonly log?: Logger;

  readonly message: string;
  readonly model: Model;
  readonly persistStuckGuard: (
    state: StuckGuardState
  ) => Effect.Effect<void, Error>;
  /** Override node:fs readFile (used by planFirstTurn for @file expansion). */
  readonly readFile?: ReadFile;

  /**
   * Run-registry hook. Fires after the drain fiber + retry abort exist; if it
   * returns false the loop fails with a busy error before doing any provider
   * work. unregisterRun fires in `Effect.ensuring` (always — success or
   * failure).
   */
  readonly registerRun?: (info: {
    harness: AgentHarness;
    retryAbort: AbortController;
    unsubscribe: () => void;
  }) => boolean;
  readonly retrySettings: RetrySettings;
  readonly sessionShape: SessionShape;

  readonly skills: Skill[];
  readonly storage: SessionStorageShape;
  readonly templates: PromptTemplate[];
  readonly thinkingLevel?: ThinkingLevel;
  readonly unregisterRun?: () => void;
}

/**
 * Run one agent prompt end-to-end: subscribe the harness event stream, register
 * the run (if hook provided), run `executeWithRetryEffect` with retry-deps that
 * dispatch `planFirstTurn` and apply auto-compaction policy (including the
 * stuck-guard), and clean up on exit.
 *
 * This is the consumer-agnostic orchestration previously inlined in
 * `apps/server/src/agent/runner.ts:runPromptEffect`. The caller builds the
 * harness and provides I/O via callbacks.
 */
export function runAgentRunEffect(
  deps: AgentRunDeps
): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    const {
      harness,
      sessionShape,
      storage,
      message,
      retrySettings,
      compactionSettings,
      model,
      apiKey,
      skills,
      templates,
      cwd,
      emit,
      loadStuckGuard,
      persistStuckGuard,
    } = deps;
    const thinkingLevel = deps.thinkingLevel;
    const log = deps.log;
    const readFile =
      deps.readFile ?? ((p: string) => readFileAsync(p).catch(() => null));

    // ── Event drain (Phase F: PubSub-backed subscribeStream) ─────
    const eventStream = harness.subscribeStream();
    const drainFiber = Effect.runFork(
      Stream.runForEach(eventStream, (event) => Effect.sync(() => emit(event)))
    );

    // ── Retry abort (covers the gap between turns — backoff sleep) ──
    const retryAbort = new AbortController();
    const unsubscribe = () => {
      Effect.runPromise(Fiber.interrupt(drainFiber).pipe(Effect.exit));
    };

    if (deps.registerRun) {
      const ok = deps.registerRun({ harness, retryAbort, unsubscribe });
      if (!ok) {
        unsubscribe();
        return yield* Effect.fail(
          new Error("A run is already active for this session")
        );
      }
    }

    // ── Stuck-guard state (cached for this run's callbacks) ──────
    const stuckGuard = yield* loadStuckGuard();
    log?.debug("stuck-guard loaded", {
      consecutiveCompacts: stuckGuard.consecutiveCompacts,
      paused: stuckGuard.paused,
    });

    // ── Build the retry deps ────────────────────────────────────
    let firstTurn = true;
    const depsEffect: RetryRunnerDepsEffect = {
      signal: retryAbort.signal,
      emit: (event) => emit(event),
      ...(log === undefined ? {} : { logger: log }),
      rollbackLeaf: () =>
        Effect.gen(function* () {
          // Orphan the failed assistant message by moving the leaf to its
          // parent, so continue() re-runs from the preceding user/toolResult
          // message.
          const branch = yield* sessionShape.getBranch();
          const lastEntry = branch.at(-1);
          if (lastEntry?.parentId) {
            yield* storage.setLeafId(lastEntry.parentId);
          }
        }),
      runTurn: () =>
        Effect.gen(function* () {
          if (firstTurn) {
            firstTurn = false;
            log?.info("turn prompt", { messageLength: message.length });
            const plan = yield* Effect.tryPromise({
              try: () =>
                planFirstTurn(message, { skills, templates }, cwd, readFile),
              catch: (e: unknown) =>
                new Error(`planFirstTurn failed: ${String(e)}`),
            });
            if (plan.kind === "template") {
              const argv = plan.args.trim()
                ? plan.args.trim().split(PROMPT_ARG_SPLIT)
                : [];
              return yield* harness.promptFromTemplateEffect(plan.name, argv);
            }
            if (plan.kind === "skill") {
              return yield* harness.skillEffect(
                plan.name,
                plan.args.length > 0 ? plan.args : undefined
              );
            }
            return yield* harness.promptEffect(plan.text);
          }
          log?.info("turn retry");
          return yield* harness.continueEffect();
        }),
      checkCompaction: (assistantMessage: AssistantMessage) =>
        Effect.gen(function* () {
          const entries = yield* sessionShape.getBranch();
          const messages = (yield* sessionShape.buildContext()).messages;
          let latestCompactionTimestamp: number | undefined;
          for (let i = entries.length - 1; i >= 0; i--) {
            const entry = entries[i];
            if (entry?.type === "compaction") {
              const ts = Date.parse(entry.timestamp);
              latestCompactionTimestamp = Number.isNaN(ts) ? undefined : ts;
              break;
            }
          }
          const decision = checkCompaction({
            message: assistantMessage,
            messages,
            contextWindow: model.contextWindow ?? 0,
            settings: compactionSettings,
            ...(latestCompactionTimestamp === undefined
              ? {}
              : { latestCompactionTimestamp }),
            ...(stuckGuard.consecutiveCompacts > 0
              ? { consecutiveCompacts: stuckGuard.consecutiveCompacts }
              : {}),
          });
          if (decision.pauseAutoCompaction) {
            stuckGuard.paused = true;
            yield* persistStuckGuard(stuckGuard);
            log?.warn("auto-compaction paused (stuck guard)", {
              consecutiveCompacts: stuckGuard.consecutiveCompacts,
            });
          } else if (decision.resetStuckGuard) {
            stuckGuard.consecutiveCompacts = 0;
            stuckGuard.paused = false;
            yield* persistStuckGuard(stuckGuard);
          }
          return decision;
        }),
      runCompaction: () =>
        Effect.gen(function* () {
          if (stuckGuard.paused) {
            return {
              ok: false as const,
              errorMessage: "Auto-compaction paused (stuck guard)",
            };
          }
          const result = yield* runAutoCompactionEffect({
            session: sessionShape,
            model,
            apiKey,
            settings: compactionSettings,
            ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
          });
          if (result.ok) {
            stuckGuard.consecutiveCompacts += 1;
            yield* persistStuckGuard(stuckGuard);
          }
          return result;
        }),
    };

    yield* executeWithRetryEffect(depsEffect, retrySettings);
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        deps.unregisterRun?.();
      })
    )
  );
}
