import { readFile as readFileAsync } from "node:fs/promises";
import type { Model } from "@sakti-code/llm";
import type { Logger } from "@sakti-code/logger";
import { Effect, Fiber, Stream } from "effect";
import type { AgentHarness } from "../agent/agent-harness.ts";
import {
  executeWithRetryEffect,
  type RetryRunnerDepsEffect,
  type RetrySettings,
} from "./retry-loop.ts";
import type { AgentHarnessEvent, PromptTemplate, Skill, ThinkingLevel } from "../harness-types.ts";
import type { ObservationalMemoryOptions } from "../observational-memory/config.ts";
import { ObservationalMemoryEngine } from "../observational-memory/engine.ts";
import { planFirstTurn, type ReadFile } from "../resources/prompt-preprocessor.ts";
import type { SessionShape } from "../session/session.ts";
import type { SessionStorageShape } from "../session/storage.ts";

const PROMPT_ARG_SPLIT = /\s+/;

export interface AgentRunDeps {
  readonly apiKey: string;
  readonly cwd: string;

  readonly emit: (event: AgentHarnessEvent) => void;
  readonly harness: AgentHarness;

  readonly log?: Logger;

  readonly message: string;
  readonly model: Model;
  readonly observationalMemory?: ObservationalMemoryOptions | undefined;
  readonly observationalMemoryReadOnly?:
    | {
        readonly getObservationsBlock: () => Promise<string | undefined>;
      }
    | undefined;
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
 * dispatch `planFirstTurn`, and clean up on exit. Context-window management is
 * handled by observational memory (observe → prune), not compaction.
 *
 * This is the consumer-agnostic orchestration previously inlined in
 * `apps/server/src/agent/runner.ts:runPromptEffect`. The caller builds the
 * harness and provides I/O via callbacks.
 */
export function runAgentRunEffect(deps: AgentRunDeps): Effect.Effect<void, Error> {
  // Hoisted so the Effect.ensuring finalizer (outside the gen body) can drain it.
  let omEngine: ObservationalMemoryEngine | undefined;
  return Effect.gen(function* () {
    const { harness, sessionShape, storage, message, retrySettings, skills, templates, cwd, emit } =
      deps;
    const log = deps.log;
    const readFile = deps.readFile ?? ((p: string) => readFileAsync(p).catch(() => null));

    // ── Retry abort (covers the gap between turns — backoff sleep) ──
    // Hoisted above the OM wiring so the engine can share the signal.
    const retryAbort = new AbortController();

    // Wire observational memory into the harness when enabled.
    if (deps.observationalMemory?.enabled) {
      const om = deps.observationalMemory;
      omEngine = new ObservationalMemoryEngine({
        deps: om.deps,
        abortSignal: retryAbort.signal,
        onOmEvent: (event) => {
          emit(event);

          // Persist completed/failed markers as CustomMessage entries for reload.
          if (event.type === "om_end" || event.type === "om_failed") {
            void Effect.runPromise(
              sessionShape.appendCustomMessageEntry("om_marker", "", false, {
                cycleId: event.cycleId,
                operationType: event.operationType,
                status: event.type === "om_end" ? "complete" : "failed",
                durationMs: event.durationMs,
                ...(event.type === "om_end"
                  ? {
                      tokensProcessed: event.tokensProcessed,
                      tokensProduced: event.tokensProduced,
                      ...(event.observations !== undefined
                        ? { observations: event.observations }
                        : {}),
                      ...(event.currentTask !== undefined
                        ? { currentTask: event.currentTask }
                        : {}),
                      ...(event.suggestedResponse !== undefined
                        ? { suggestedResponse: event.suggestedResponse }
                        : {}),
                    }
                  : { error: event.error }),
              }),
            ).catch(() => {});
          }
        },
      });
      harness.setObservationalMemory({
        engine: omEngine,
        getBaseSystemPrompt: () => {
          // Deliberately read the harness's stable composed base prompt
          // (NOT currentContext.systemPrompt) so appended <observations>
          // don't accumulate across turns. Trade-off: any prepareNextTurn
          // edit to the system prompt is overwritten when OM is on — no
          // such editor exists today, but flag here if one is added.
          const current = harness.getSystemPrompt();
          return current ?? "";
        },
      });
    }

    // Wire read-only OM injection when OM is disabled but prior history may exist.
    if (!deps.observationalMemory?.enabled && deps.observationalMemoryReadOnly) {
      harness.setObservationalMemoryReadOnly(deps.observationalMemoryReadOnly);
    }

    // ── Event drain (Phase F: PubSub-backed subscribeStream) ─────
    const eventStream = harness.subscribeStream();
    const drainFiber = Effect.runFork(
      Stream.runForEach(eventStream, (event) => Effect.sync(() => emit(event))),
    );
    const unsubscribe = () => {
      void Effect.runPromise(Fiber.interrupt(drainFiber).pipe(Effect.exit));
    };

    if (deps.registerRun) {
      const ok = deps.registerRun({ harness, retryAbort, unsubscribe });
      if (!ok) {
        unsubscribe();
        return yield* Effect.fail(new Error("A run is already active for this session"));
      }
    }

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
              try: () => planFirstTurn(message, { skills, templates }, cwd, readFile),
              catch: (e: unknown) => new Error(`planFirstTurn failed: ${String(e)}`),
            });
            if (plan.kind === "template") {
              const argv = plan.args.trim() ? plan.args.trim().split(PROMPT_ARG_SPLIT) : [];
              return yield* harness.promptFromTemplateEffect(plan.name, argv);
            }
            if (plan.kind === "skill") {
              return yield* harness.skillEffect(
                plan.name,
                plan.args.length > 0 ? plan.args : undefined,
              );
            }
            return yield* harness.promptEffect(plan.text);
          }
          log?.info("turn retry");
          return yield* harness.continueEffect();
        }),
    };

    yield* executeWithRetryEffect(depsEffect, retrySettings);
  }).pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        // Drain detached OM buffering so a slow observe/reflector completes
        // before the run tears down. Best-effort: waitForBuffering can't
        // reject (uses allSettled + timeout), but catch as defense-in-depth.
        if (omEngine) {
          yield* Effect.promise(() => omEngine!.waitForBuffering(30_000).catch(() => {}));
        }
        deps.unregisterRun?.();
      }),
    ),
  );
}
