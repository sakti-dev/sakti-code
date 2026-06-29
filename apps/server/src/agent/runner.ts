import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  AgentDefinition,
  AgentHarness,
  AgentHarnessEvent,
  PermissionRuleset,
  SessionStorageShape,
  StuckGuardState,
  ThinkingLevel,
} from "@sakti-code/agent";
import {
  BUILTIN_AGENTS,
  checkCompaction,
  composeSystemPrompt,
  DEFAULT_AGENT_NAME,
  evaluate,
  executeWithRetryEffect,
  fromConfig,
  AgentHarness as HarnessClass,
  INTAKE_SYSTEM_PROMPT,
  PromiseSession,
  parseSessionSettings,
  planFirstTurn,
  promiseSessionAsShape,
  type RetryRunnerDepsEffect,
  runAutoCompactionEffect,
} from "@sakti-code/agent";
import { createProposeSessionTool, type EditMode } from "@sakti-code/tools";
import { Effect, Fiber, Stream } from "effect";
import type { ServerContext } from "../context.ts";
import { loadAgentContext } from "../lib/context-loader.ts";
import {
  getPermissionChannel,
  type PermissionFrame,
} from "../lib/permission-channel.ts";
import { NodeExecutionEnv } from "./execution-env.ts";
import { resolveAuth } from "./model-resolver.ts";
import { type ReplayEntry, ReplayRunner } from "./replay-runner.ts";
import { buildTools } from "./tools-builder.ts";
import type { WsHandle } from "./ws-handler.ts";

const PROMPT_ARG_SPLIT = /\s+/;

interface ActiveRun {
  harness: AgentHarness;
  /**
   * Abort controller for the retry loop's backoff sleep. The harness's own
   * abort covers in-progress turns; this one covers the gap between turns
   * (when the harness is idle but we're sleeping before a retry). `abortRun`
   * aborts both so a user cancel interrupts the full retry sequence.
   */
  retryAbort?: AbortController | undefined;
  unsubscribe: () => void;
}

const activeRuns = new Map<string, ActiveRun>();

export function busyMessage(sessionId: string): string {
  return `A run is already active for session ${sessionId}. Send a 'steer' or 'followUp' message to queue input, or 'abort' to cancel the active run first.`;
}

export function registerRun(
  sessionId: string,
  harness: AgentHarness,
  unsubscribe: () => void,
  retryAbort?: AbortController
): boolean {
  if (activeRuns.has(sessionId)) {
    return false;
  }
  activeRuns.set(sessionId, {
    harness,
    unsubscribe,
    ...(retryAbort ? { retryAbort } : {}),
  });
  return true;
}

export function unregisterRun(sessionId: string) {
  const run = activeRuns.get(sessionId);
  if (run) {
    run.unsubscribe();
  }
  activeRuns.delete(sessionId);
}

export function isRunActive(sessionId: string): boolean {
  return activeRuns.has(sessionId);
}

export function clearRunsForTesting(): void {
  for (const run of activeRuns.values()) {
    run.unsubscribe();
  }
  activeRuns.clear();
}

// ── Replay (dev-only) ─────────────────────────────────────────────

const REPLAY_PATH =
  process.env.SAKTI_REPLAY_PATH ??
  resolve(import.meta.dirname, "../../fixtures/replay.jsonl");

const activeReplays = new Map<string, ReplayRunner>();

export function clearReplaysForTesting(): void {
  for (const runner of activeReplays.values()) {
    runner.abort();
  }
  activeReplays.clear();
}

export async function startReplay(
  sessionId: string,
  ws: WsHandle
): Promise<void> {
  if (activeReplays.has(sessionId)) {
    return;
  }
  if (activeRuns.has(sessionId)) {
    throw new Error(busyMessage(sessionId));
  }

  const data = readFileSync(REPLAY_PATH, "utf-8");
  const entries: ReplayEntry[] = data
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as ReplayEntry);

  const runner = new ReplayRunner(entries, ws, sessionId, {
    wordDelayMs: 15,
    toolDelayMs: 300,
  });
  activeReplays.set(sessionId, runner);

  try {
    await runner.run();
  } finally {
    activeReplays.delete(sessionId);
  }
}

export function pauseReplay(sessionId: string): boolean {
  const runner = activeReplays.get(sessionId);
  if (runner) {
    runner.pause();
    return true;
  }
  return false;
}

export function resumeReplay(sessionId: string): boolean {
  const runner = activeReplays.get(sessionId);
  if (runner) {
    runner.resume();
    return true;
  }
  return false;
}

export function stopReplay(sessionId: string): boolean {
  const runner = activeReplays.get(sessionId);
  if (runner) {
    runner.abort();
    return true;
  }
  return false;
}

export async function abortRun(sessionId: string): Promise<boolean> {
  const run = activeRuns.get(sessionId);
  if (run) {
    // Abort the retry backoff sleep (if mid-retry) AND the in-progress turn.
    run.retryAbort?.abort();
    await run.harness.abort();
    return true;
  }
  return false;
}

export function getActiveHarness(sessionId: string): AgentHarness | null {
  const run = activeRuns.get(sessionId);
  return run?.harness ?? null;
}

const DEFAULT_SETTINGS: Record<string, string> = {
  auto_compaction: "false",
  auto_retry: "true",
  // Exponential backoff base for application-level retry (2s → 4s → 8s).
  // Matches pi's coding-agent defaults (settings-manager.ts:807-813).
  base_delay_ms: "2000",
  follow_up_mode: "all",
  max_retries: "3",
  steering_mode: "all",
  thinking_level: "off",
};

/**
 * Load the raw per-session settings overrides from the DB (no defaults merged).
 * Callers wrap with `parseSessionSettings(...)` from `@sakti-code/agent` to
 * get a typed view with defaults applied.
 */
export function loadSessionSettings(
  ctx: ServerContext,
  sessionId: string
): Record<string, string> {
  const prefix = `session:${sessionId}:`;
  const rows = ctx.repos.settings.getByPrefix(prefix);
  const overrides: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.slice(prefix.length);
    overrides[key] = row.value;
  }
  return overrides;
}

/** @deprecated Kept until tests migrate to `parseSessionSettings(loadSessionSettings(...))`. */
export function loadSessionSettingsWithDefaults(
  ctx: ServerContext,
  sessionId: string
): Record<string, string> {
  return { ...DEFAULT_SETTINGS, ...loadSessionSettings(ctx, sessionId) };
}

/**
 * Load the set of disabled skill names for a session.
 *
 * Disabled skills are stored as keyed-prefix entries in the settings table:
 *   `session:<id>:disabled_skill:<name>` = "1"
 *
 * This is the persistent substrate (Layer 1) that survives app restart. On
 * restart, `loadAgentContext` rescans disk for skill files; the runner then
 * filters out names in this set before composing the harness system prompt via
 * `appendSkillsBlock`. The harness therefore starts in the correct state
 * without any in-memory pending-refresh state needed.
 *
 * Keyed-prefix (not JSON array) so each enable/disable is a single key
 * write/delete — atomic, no read-modify-write cycle.
 */
export function loadDisabledSkills(
  ctx: ServerContext,
  sessionId: string
): Set<string> {
  const prefix = `session:${sessionId}:disabled_skill:`;
  const rows = ctx.repos.settings.getByPrefix(prefix);
  const names = new Set<string>();
  for (const row of rows) {
    const name = row.key.slice(prefix.length);
    if (name.length > 0) {
      names.add(name);
    }
  }
  return names;
}

/** Persist a skill-disable for this session (idempotent). Layer 1 only. */
export async function persistSkillDisabled(
  ctx: ServerContext,
  sessionId: string,
  skillName: string
): Promise<void> {
  await ctx.repos.settings.set(
    `session:${sessionId}:disabled_skill:${skillName}`,
    "1"
  );
}

/** Remove a skill-disable for this session (idempotent). Layer 1 only. */
export async function persistSkillEnabled(
  ctx: ServerContext,
  sessionId: string,
  skillName: string
): Promise<void> {
  await ctx.repos.settings.delete(
    `session:${sessionId}:disabled_skill:${skillName}`
  );
}

/**
 * # Stuck-guard state persistence (§4)
 *
 * {@link StuckGuardState} (typed in `@sakti-code/agent`) tracks consecutive
 * auto-compactions so `checkCompaction` can pause when the context window is
 * too small (≥2 compacts in a row that still leave the prompt over threshold).
 * The pure decision lives in `packages/agent/.../auto-compaction.ts`; this
 * module owns the persistence so the counter survives across `runPrompt`
 * calls (each of which builds a fresh harness) and across app restarts.
 *
 * Keys (settings table):
 *   `session:<id>:consecutive_compacts`   — stringified non-negative int
 *   `session:<id>:auto_compaction_paused` — present ("1") iff the guard latched
 *
 * The paused key is deleted (not set to "0") when the guard clears, so the
 * common steady state keeps the settings table clean.
 */

export function loadStuckGuardState(
  ctx: ServerContext,
  sessionId: string
): StuckGuardState {
  const rawCount = ctx.repos.settings.get(
    `session:${sessionId}:consecutive_compacts`
  );
  const parsed = Number.parseInt(rawCount ?? "0", 10);
  const consecutiveCompacts =
    Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  const paused =
    ctx.repos.settings.get(`session:${sessionId}:auto_compaction_paused`) ===
    "1";
  return { consecutiveCompacts, paused };
}

export async function persistStuckGuardState(
  ctx: ServerContext,
  sessionId: string,
  state: StuckGuardState
): Promise<void> {
  await ctx.repos.settings.set(
    `session:${sessionId}:consecutive_compacts`,
    String(state.consecutiveCompacts)
  );
  if (state.paused) {
    await ctx.repos.settings.set(
      `session:${sessionId}:auto_compaction_paused`,
      "1"
    );
  } else {
    await ctx.repos.settings.delete(
      `session:${sessionId}:auto_compaction_paused`
    );
  }
}

export function resolveThinkingLevel(
  ctx: ServerContext,
  sessionId: string,
  session: { thinkingLevel: string },
  profileThinkingLevel = "off"
): ThinkingLevel {
  const thinkingLevelRow = ctx.repos.settings.get(
    `session:${sessionId}:thinking_level`
  );
  if (thinkingLevelRow !== null) {
    if (thinkingLevelRow === "off") {
      return "off";
    }
    return thinkingLevelRow as ThinkingLevel;
  }
  if (session.thinkingLevel !== "off") {
    return session.thinkingLevel as ThinkingLevel;
  }
  return profileThinkingLevel as ThinkingLevel;
}

export function resolveEditMode(
  ctx: ServerContext,
  sessionId: string
): EditMode {
  const row = ctx.repos.settings.get(`session:${sessionId}:edit_mode`);
  if (row === "hashline" || row === "replace") {
    return row;
  }
  return "hashline";
}

/**
 * Resolve an agent by name from builtins plus project-loaded agents (a
 * user-defined agent with the same name overrides the builtin). Falls back to
 * the default (`build`) agent when the name is unknown.
 */
export function resolveAgentByName(
  name: string,
  loadedAgents: AgentDefinition[]
): AgentDefinition {
  const byName = new Map<string, AgentDefinition>();
  for (const agent of BUILTIN_AGENTS) {
    byName.set(agent.name, agent);
  }
  for (const agent of loadedAgents) {
    byName.set(agent.name, agent);
  }
  const resolved = byName.get(name) ?? byName.get(DEFAULT_AGENT_NAME);
  if (resolved) {
    return resolved;
  }
  // Unreachable: builtins always seed DEFAULT_AGENT_NAME ("build") above.
  throw new Error(`No agent resolved for "${name}"`);
}

/** Load project agents and resolve the active agent by name. */
export async function resolveSessionAgent(
  projectCwd: string,
  agentName: string
): Promise<AgentDefinition> {
  const { agents } = await loadAgentContext(projectCwd);
  return resolveAgentByName(agentName, agents);
}

/** Build a loop permission evaluator closed over a ruleset. */
export function buildPermissionEvaluator(ruleset: PermissionRuleset) {
  return (permission: string, pattern: string): "allow" | "deny" | "ask" =>
    evaluate(permission, pattern, ruleset).action;
}

/**
 * Persist the selected agent for a session and, when a run is active, apply it
 * to the live harness immediately (permission evaluator + switchAgent). Returns
 * `false` only when the session does not exist.
 */
export async function switchAgentForSession(
  ctx: ServerContext,
  sessionId: string,
  agentName: string
): Promise<boolean> {
  const session = await ctx.repos.sessions.findById(sessionId);
  if (!session) {
    return false;
  }
  await ctx.repos.settings.set(`session:${sessionId}:agent`, agentName);
  const harness = getActiveHarness(sessionId);
  if (harness) {
    const project = await ctx.repos.projects.findById(session.projectId);
    if (project) {
      const agent = await resolveSessionAgent(project.cwd, agentName);
      const ruleset = agent.permission ?? fromConfig({ "*": "allow" });
      // Mirror runPrompt: the evaluator merges live grants so an "always"
      // accrued earlier in the session survives a mid-run agent switch.
      const channel = getPermissionChannel(sessionId);
      harness.setPermissionEvaluator((permission, pattern) =>
        channel.evaluate(permission, pattern, ruleset)
      );
      await harness.switchAgent(agent);
    }
  }
  return true;
}

export async function setEditModeForSession(
  ctx: ServerContext,
  sessionId: string,
  mode: EditMode
): Promise<boolean> {
  const session = await ctx.repos.sessions.findById(sessionId);
  if (!session) {
    return false;
  }

  // Layer 1: persist (survives restart)
  await ctx.repos.settings.set(`session:${sessionId}:edit_mode`, mode);

  // Layer 2: live apply (swap executor + schema immediately, defer
  // description to compaction)
  const harness = getActiveHarness(sessionId);
  if (harness) {
    const project = await ctx.repos.projects.findById(session.projectId);
    if (project) {
      const newTools = buildTools(project.cwd, mode);
      const newEditTool = newTools.find((t) => t.name === "edit");
      if (newEditTool) {
        await harness.swapTool("edit", newEditTool as never);
      }
    }
  }
  return true;
}

export function runPromptEffect(
  ctx: ServerContext,
  sessionId: string,
  message: string,
  storage: SessionStorageShape,
  eventCallback: (event: AgentHarnessEvent) => void,
  permissionAskedSink: (frame: PermissionFrame) => void
): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    const session = ctx.repos.sessions.findById(sessionId);
    if (!session) {
      return yield* Effect.fail(new Error(`Session not found: ${sessionId}`));
    }
    ctx.log?.agent.debug("session loaded", {
      sessionId,
      projectId: session.projectId,
      kind: session.kind,
      thinkingLevel: (session as { thinkingLevel: string }).thinkingLevel,
    });

    const project = ctx.repos.projects.findById(session.projectId);
    if (!project) {
      return yield* Effect.fail(
        new Error(`Project not found: ${session.projectId}`)
      );
    }
    ctx.log?.agent.debug("project loaded", {
      projectId: project.id,
      cwd: project.cwd,
    });

    const auth = resolveAuth(ctx, session);
    if (!auth) {
      return yield* Effect.fail(
        new Error(
          "No API key configured for this session's provider — add one in Settings > Models"
        )
      );
    }
    const { model } = auth;
    const isIntake = session.kind === "intake";
    const settings = parseSessionSettings(loadSessionSettings(ctx, sessionId));
    const editMode = resolveEditMode(ctx, sessionId);
    const tools = buildTools(project.cwd, editMode);
    if (isIntake) {
      tools.push(createProposeSessionTool() as (typeof tools)[number]);
    }

    const thinkingLevel = resolveThinkingLevel(
      ctx,
      sessionId,
      session,
      auth.thinkingLevel
    );
    const compactionSettings = settings.compaction();

    const env = new NodeExecutionEnv(project.cwd);
    const sessionInstance = new PromiseSession(storage);
    const sessionShape = promiseSessionAsShape(sessionInstance);
    const getApiKeyAndHeaders = async (
      _model: unknown
    ): Promise<
      { apiKey: string; headers?: Record<string, string> } | undefined
    > => ({ apiKey: auth.apiKey });

    // Load the project's full agent context once: used both to wire the harness
    // resources (skills + command templates, so harness.skill/promptFromTemplate
    // resolve) and to resolve the session agent by name without a second scan.
    const loadedContext = yield* Effect.tryPromise({
      try: () => loadAgentContext(project.cwd),
      catch: (e: unknown) =>
        new Error(`Failed to load agent context: ${String(e)}`),
    });

    // Layer 1: filter out skills disabled for this session (persistent state
    // surviving app restart). The keyed-prefix entries are read once at run
    // start; in-session disables use the harness's removeSkill() (Layer 2) and
    // don't need to touch this filter.
    const disabledSkills = loadDisabledSkills(ctx, sessionId);
    const activeSkills = loadedContext.skills.filter(
      (skill) => !disabledSkills.has(skill.name)
    );

    const harness = new HarnessClass({
      env,
      model,
      session: sessionShape,
      ...(isIntake
        ? {
            systemPrompt: composeSystemPrompt(
              INTAKE_SYSTEM_PROMPT,
              tools,
              [],
              false
            ),
          }
        : {}),
      ...(ctx.log === undefined
        ? {}
        : { logger: ctx.log.agent, streamLogger: ctx.log.llm }),
      tools,
      followUpMode: settings.followUpMode(),
      steeringMode: settings.steeringMode(),
      thinkingLevel,
      getApiKeyAndHeaders,
      resources: {
        skills: activeSkills,
        promptTemplates: loadedContext.commands,
      },
    });
    ctx.log?.agent.debug("harness created", { sessionId });

    // Resolve the session's selected agent (default `build`) and wire its
    // permission ruleset into the loop. For non-intake sessions, switchAgent also
    // applies the agent's system prompt + tool allowlist + thinking level.
    // Intake keeps its dedicated INTAKE_SYSTEM_PROMPT and proposeSession flow.
    const agentName = settings.agent();
    const agent = resolveAgentByName(agentName, loadedContext.agents);
    const agentRuleset = agent.permission ?? fromConfig({ "*": "allow" });

    // Wire the interactive permission channel: the evaluator merges live grants
    // (so a prior "always" auto-allows), and the ask resolver bridges to the WS
    // approval strip. Grants persist across runs; the sink is reattached here.
    const permissionChannel = getPermissionChannel(sessionId);
    permissionChannel.setSink(permissionAskedSink);
    harness.setPermissionEvaluator((permission, pattern) =>
      permissionChannel.evaluate(permission, pattern, agentRuleset)
    );
    harness.setPermissionAskResolver((req) => permissionChannel.ask(req));

    if (!isIntake) {
      // Compose the agent's system prompt with the tool inventory and the
      // available-skills block (mirrors pi's coding-agent buildSystemPrompt):
      // tool descriptions are always embedded so smaller LLMs see how to use
      // each tool; skills are advertised only when `read` is available, since
      // they're loaded by reading the SKILL.md path. Intake composes its own
      // prompt at construction time (tool inventory only, no skills).
      // `activeSkills` already excludes Layer-1-disabled skills.
      const hasRead =
        agent.activeToolNames === undefined ||
        agent.activeToolNames.includes("read");
      const activeNames = agent.activeToolNames;
      const activeTools =
        activeNames === undefined
          ? tools
          : tools.filter((t) => activeNames.includes(t.name));
      const composedSystemPrompt = composeSystemPrompt(
        agent.systemPrompt,
        activeTools,
        activeSkills,
        hasRead
      );
      yield* harness.switchAgentEffect(
        composedSystemPrompt === agent.systemPrompt
          ? agent
          : { ...agent, systemPrompt: composedSystemPrompt }
      );
    }
    ctx.log?.agent.debug("agent resolved", { sessionId, agent: agent.name });

    // Phase F: event delivery via PubSub-backed subscribeStream (decoupled,
    // non-blocking broadcast — no per-listener `await` serialization on the
    // hot path). The drain runs concurrently with executeWithRetryEffect below.
    const eventStream = harness.subscribeStream();
    const drainFiber = Effect.runFork(
      Stream.runForEach(eventStream, (event) =>
        Effect.sync(() => eventCallback(event))
      )
    );

    // Abort controller spanning the full run, including the retry backoff sleep.
    // abortRun() aborts this so a user cancel interrupts the retry sequence
    // even when the harness itself is idle between turns.
    const retryAbort = new AbortController();

    const unsubscribe = () => {
      Effect.runPromise(Fiber.interrupt(drainFiber).pipe(Effect.exit));
    };

    if (!registerRun(sessionId, harness, unsubscribe, retryAbort)) {
      unsubscribe();
      return yield* Effect.fail(new Error(busyMessage(sessionId)));
    }

    ctx.log?.agent.info("run starting", {
      sessionId,
      model: model.id,
      provider: model.provider,
      hasApiKey: auth.apiKey !== undefined,
      toolCount: tools.length,
      thinkingLevel,
      isIntake,
    });

    // Application-level retry: run the turn, and on a transient failure emit
    // auto_retry_start/end events, roll the session leaf back past the failed
    // message, back off, and re-run via harness.continue(). See retry-loop.ts.
    const retrySettings = settings.retry();
    let firstTurn = true;
    // Stuck-guard state (§4) persists across prompts via the settings table
    // because each runPrompt builds a fresh harness; the closure caches the
    // loaded state for this run's callbacks (the overflow retry loop can fire
    // checkCompaction/runCompaction multiple times in one run).
    const stuckGuard = loadStuckGuardState(ctx, sessionId);

    const depsEffect: RetryRunnerDepsEffect = {
      signal: retryAbort.signal,
      emit: (event) => eventCallback(event),
      ...(ctx.log === undefined ? {} : { logger: ctx.log.agent }),
      rollbackLeaf: () =>
        Effect.gen(function* () {
          // Orphan the failed assistant message by moving the leaf to its
          // parent, so continue() re-runs from the preceding user/toolResult
          // message. Assumes the failed turn appended exactly one entry —
          // which holds for the transient provider errors we retry (429/5xx
          // fail at the request, before any tools execute). shouldRetry only
          // classifies stopReason === "error" messages, so non-transient or
          // tool-producing turns never reach here.
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
            ctx.log?.agent.info("turn prompt", {
              sessionId,
              messageLength: message.length,
            });
            // Prompt preprocessor: a leading `/name` or `skill:name` dispatches
            // to the matching harness method; otherwise run as a prompt with any
            // `@file` mentions expanded into the message.
            const plan = yield* Effect.tryPromise({
              try: () =>
                planFirstTurn(
                  message,
                  {
                    skills: activeSkills,
                    templates: loadedContext.commands,
                  },
                  project.cwd,
                  (p) => readFile(p).catch(() => null)
                ),
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
          ctx.log?.agent.info("turn retry", { sessionId });
          return yield* harness.continueEffect();
        }),
      checkCompaction: (assistantMessage) =>
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
          // Apply stuck-guard side effects so they survive to the next prompt.
          if (decision.pauseAutoCompaction) {
            stuckGuard.paused = true;
            yield* Effect.tryPromise({
              try: () => persistStuckGuardState(ctx, sessionId, stuckGuard),
              catch: (e: unknown) =>
                new Error(`persistStuckGuardState failed: ${String(e)}`),
            });
            ctx.log?.agent.warn("auto-compaction paused (stuck guard)", {
              sessionId,
              consecutiveCompacts: stuckGuard.consecutiveCompacts,
            });
          } else if (decision.resetStuckGuard) {
            stuckGuard.consecutiveCompacts = 0;
            stuckGuard.paused = false;
            yield* Effect.tryPromise({
              try: () => persistStuckGuardState(ctx, sessionId, stuckGuard),
              catch: (e: unknown) =>
                new Error(`persistStuckGuardState failed: ${String(e)}`),
            });
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
            apiKey: auth.apiKey,
            settings: compactionSettings,
            ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
          });
          if (result.ok) {
            stuckGuard.consecutiveCompacts += 1;
            yield* Effect.tryPromise({
              try: () => persistStuckGuardState(ctx, sessionId, stuckGuard),
              catch: (e: unknown) =>
                new Error(`persistStuckGuardState failed: ${String(e)}`),
            });
          }
          return result;
        }),
    };

    yield* executeWithRetryEffect(depsEffect, retrySettings);
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        ctx.log?.agent.info("run finished", { sessionId });
        // Reject any still-pending permission asks so the UI strip clears and the
        // loop is not left awaiting a reply on a dead/aborted run.
        getPermissionChannel(sessionId).rejectPending();
        unregisterRun(sessionId);
      })
    ),
    Effect.mapError((error) => {
      const err =
        error instanceof Error
          ? error
          : new Error(`Run failed: ${String(error)}`);
      ctx.log?.agent.error("run failed", err, { sessionId });
      return err;
    })
  );
}

/**
 * Promise wrapper around {@link runPromptEffect} for back-compat with callers
 * that haven't migrated to Effect (e.g. tests). The WS handler uses this too
 * — the single Effect.runPromise boundary for the production run path lives
 * here, with the Effect.gen body providing the structured-concurrency shape.
 */
export function runPrompt(
  ctx: ServerContext,
  sessionId: string,
  message: string,
  storage: SessionStorageShape,
  eventCallback: (event: AgentHarnessEvent) => void,
  permissionAskedSink: (frame: PermissionFrame) => void
): Promise<void> {
  return Effect.runPromise(
    runPromptEffect(
      ctx,
      sessionId,
      message,
      storage,
      eventCallback,
      permissionAskedSink
    )
  );
}
