import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  AgentHarness,
  AgentHarnessEvent,
  PermissionRuleset,
  SessionStorageShape,
  StuckGuardState,
  ThinkingLevel,
} from "@sakti-code/agent";
import {
  composeSystemPrompt,
  evaluate,
  fromConfig,
  AgentHarness as HarnessClass,
  PromiseSession,
  parseSessionSettings,
  promiseSessionAsShape,
  runAgentRunEffect,
} from "@sakti-code/agent";
import { type EditMode, InMemorySnapshotStore } from "@sakti-code/tools";
import { Effect } from "effect";
import {
  resolveSessionAgent,
  resolveSessionAgentForKind,
} from "../agents/resolve-agent.ts";
import { DEFAULT_AGENT_NAME } from "../agents/server-agents.ts";
import {
  buildAgentTools,
  rebuildTool,
  type ToolContext,
} from "../agents/tool-registry.ts";
import type { ServerContext } from "../context.ts";
import { loadAgentContext } from "../lib/context-loader.ts";
import {
  getPermissionChannel,
  type PermissionFrame,
} from "../lib/permission-channel.ts";
import { NodeExecutionEnv } from "./execution-env.ts";
import { resolveAuth } from "./model-resolver.ts";
import { type ReplayEntry, ReplayRunner } from "./replay-runner.ts";
import type { WsHandle } from "./ws-handler.ts";

/**
 * Fallback tool surface for agents that don't declare `activeToolNames`.
 * Project-loaded `.sakti/agents/*.md` files may omit the tool list (legacy
 * format) — in that case the agent gets the full coding toolset. Server
 * catalog entries (SERVER_AGENTS) all declare explicit lists, so this only
 * applies to user-defined agents that don't.
 */
const DEFAULT_TOOL_NAMES: readonly string[] = [
  "read",
  "write",
  "edit",
  "bash",
  "grep",
  "find",
  "ls",
];

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
 *
 * @deprecated Moved to {@link "../agents/resolve-agent.ts"}. Re-exported here
 * for back-compat with external callers (e.g. compaction route).
 */
/** Load project agents and resolve the active agent by name. */
export {
  resolveAgentByName,
  resolveSessionAgent,
} from "../agents/resolve-agent.ts";

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
  // description to compaction). Rebuild the edit tool with a fresh snapshot
  // store — the harness's existing edit state was captured by the old tool
  // instance; the new instance starts clean for the new edit mode.
  const harness = getActiveHarness(sessionId);
  if (harness) {
    const project = await ctx.repos.projects.findById(session.projectId);
    if (project) {
      const editCtx: ToolContext = {
        cwd: project.cwd,
        editMode: mode,
        snapshotStore: new InMemorySnapshotStore(),
        noopOwner: {},
      };
      const newEditTool = rebuildTool("edit", editCtx);
      await harness.swapTool("edit", newEditTool as never);
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
    const settings = parseSessionSettings(loadSessionSettings(ctx, sessionId));
    const editMode = resolveEditMode(ctx, sessionId);

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

    // Resolve the agent: per-session override first (when it differs from the
    // default), then kind-based default. Intake sessions resolve to the intake
    // agent entry — own permission ruleset + own tool list (incl. propose_session).
    // No isIntake branches anywhere: intake flows through the same path as build.
    const { agent } = resolveSessionAgentForKind(
      session.kind,
      loadedContext.agents,
      settings.agent() === DEFAULT_AGENT_NAME ? undefined : settings.agent()
    );

    // Build only the agent's declared tools via the server registry. Each agent
    // entry is fully self-contained — propose_session is built only when the
    // intake agent declares it; build/explore/plan/general never see it.
    const toolCtx: ToolContext = {
      cwd: project.cwd,
      editMode,
      snapshotStore: new InMemorySnapshotStore(),
      noopOwner: {},
    };
    const tools = buildAgentTools(
      agent.activeToolNames ?? DEFAULT_TOOL_NAMES,
      toolCtx
    );

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

    // Wire the interactive permission channel: the evaluator merges live grants
    // (so a prior "always" auto-allows), and the ask resolver bridges to the WS
    // approval strip. Grants persist across runs; the sink is reattached here.
    const agentRuleset = agent.permission ?? fromConfig({ "*": "allow" });
    const permissionChannel = getPermissionChannel(sessionId);
    permissionChannel.setSink(permissionAskedSink);
    harness.setPermissionEvaluator((permission, pattern) =>
      permissionChannel.evaluate(permission, pattern, agentRuleset)
    );
    harness.setPermissionAskResolver((req) => permissionChannel.ask(req));

    // Compose the agent's system prompt with the tool inventory and the
    // available-skills block (mirrors pi's coding-agent buildSystemPrompt):
    // tool descriptions are always embedded so smaller LLMs see how to use
    // each tool; skills are advertised only when `read` is available, since
    // they're loaded by reading the SKILL.md path. The tool list passed here
    // matches what's already on the harness (agent.activeToolNames).
    const hasRead =
      agent.activeToolNames === undefined ||
      agent.activeToolNames.includes("read");
    const composedSystemPrompt = composeSystemPrompt(
      agent.systemPrompt,
      tools,
      activeSkills,
      hasRead
    );
    yield* harness.switchAgentEffect(
      composedSystemPrompt === agent.systemPrompt
        ? agent
        : { ...agent, systemPrompt: composedSystemPrompt }
    );
    ctx.log?.agent.debug("agent resolved", { sessionId, agent: agent.name });

    ctx.log?.agent.info("run starting", {
      sessionId,
      model: model.id,
      provider: model.provider,
      hasApiKey: auth.apiKey !== undefined,
      toolCount: tools.length,
      thinkingLevel,
      agent: agent.name,
    });

    // Delegate the orchestration (event drain, retry abort, retry-deps
    // assembly, planFirstTurn dispatch, stuck-guard policy, compaction
    // callbacks, ensuring cleanup) to the factory in @sakti-code/agent.
    yield* runAgentRunEffect({
      harness,
      sessionShape,
      storage,
      message,
      retrySettings: settings.retry(),
      compactionSettings,
      model,
      apiKey: auth.apiKey,
      ...(thinkingLevel === undefined ? {} : { thinkingLevel }),
      skills: activeSkills,
      templates: loadedContext.commands,
      cwd: project.cwd,
      loadStuckGuard: () =>
        Effect.sync(() => loadStuckGuardState(ctx, sessionId)),
      persistStuckGuard: (s) =>
        Effect.tryPromise(() => persistStuckGuardState(ctx, sessionId, s)),
      emit: eventCallback,
      registerRun: ({ harness: h, retryAbort, unsubscribe }) =>
        registerRun(sessionId, h, unsubscribe, retryAbort),
      unregisterRun: () => unregisterRun(sessionId),
      ...(ctx.log === undefined ? {} : { log: ctx.log.agent }),
    });
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        ctx.log?.agent.info("run finished", { sessionId });
        // Reject any still-pending permission asks so the UI strip clears and the
        // loop is not left awaiting a reply on a dead/aborted run.
        getPermissionChannel(sessionId).rejectPending();
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
