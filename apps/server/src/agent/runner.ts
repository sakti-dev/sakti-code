import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  AgentDefinition,
  AgentHarness,
  AgentHarnessEvent,
  PermissionRuleset,
  QueueMode,
  SessionStorage,
  ThinkingLevel,
} from "@sakti-code/agent";
import {
  evaluate,
  fromConfig,
  AgentHarness as HarnessClass,
  INTAKE_SYSTEM_PROMPT,
  Session as SessionClass,
} from "@sakti-code/agent";
import { createProposeSessionTool } from "@sakti-code/tools";
import type { ServerContext } from "../context.ts";
import { loadAgentContext } from "../lib/context-loader.ts";
import { BUILTIN_AGENTS, DEFAULT_AGENT_NAME } from "./builtin-agents.ts";
import { NodeExecutionEnv } from "./execution-env.ts";
import { resolveAuth } from "./model-resolver.ts";
import { type ReplayEntry, ReplayRunner } from "./replay-runner.ts";
import { executeWithRetry, parseRetrySettings } from "./retry-loop.ts";
import { buildTools } from "./tools-builder.ts";
import type { WsHandle } from "./ws-handler.ts";

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
  return { ...DEFAULT_SETTINGS, ...overrides };
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
  return resolved ?? BUILTIN_AGENTS[0];
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
      harness.setPermissionEvaluator(buildPermissionEvaluator(ruleset));
      await harness.switchAgent(agent);
    }
  }
  return true;
}

export async function runPrompt(
  ctx: ServerContext,
  sessionId: string,
  message: string,
  storage: SessionStorage,
  eventCallback: (event: AgentHarnessEvent) => void
): Promise<void> {
  const session = await ctx.repos.sessions.findById(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }
  ctx.log?.agent.debug("session loaded", {
    sessionId,
    projectId: session.projectId,
    kind: session.kind,
    thinkingLevel: (session as { thinkingLevel: string }).thinkingLevel,
  });

  const project = await ctx.repos.projects.findById(session.projectId);
  if (!project) {
    throw new Error(`Project not found: ${session.projectId}`);
  }
  ctx.log?.agent.debug("project loaded", {
    projectId: project.id,
    cwd: project.cwd,
  });

  const auth = resolveAuth(ctx, session);
  if (!auth) {
    throw new Error(
      "No API key configured for this session's provider — add one in Settings > Models"
    );
  }
  const { model } = auth;
  const isIntake = session.kind === "intake";
  const tools = buildTools(project.cwd);
  if (isIntake) {
    tools.push(createProposeSessionTool());
  }

  const settings = loadSessionSettings(ctx, sessionId);
  const thinkingLevel = resolveThinkingLevel(
    ctx,
    sessionId,
    session,
    auth.thinkingLevel
  );

  const env = new NodeExecutionEnv(project.cwd);
  const sessionInstance = new SessionClass(storage);
  const getApiKeyAndHeaders = async (
    _model: unknown
  ): Promise<
    { apiKey: string; headers?: Record<string, string> } | undefined
  > => ({ apiKey: auth.apiKey });

  const harness = new HarnessClass({
    env,
    model,
    session: sessionInstance,
    ...(isIntake ? { systemPrompt: INTAKE_SYSTEM_PROMPT } : {}),
    ...(ctx.log === undefined
      ? {}
      : { logger: ctx.log.agent, streamLogger: ctx.log.llm }),
    tools,
    followUpMode: settings.follow_up_mode as QueueMode,
    steeringMode: settings.steering_mode as QueueMode,
    thinkingLevel,
    getApiKeyAndHeaders,
  });
  ctx.log?.agent.debug("harness created", { sessionId });

  // Resolve the session's selected agent (default `build`) and wire its
  // permission ruleset into the loop. For non-intake sessions, switchAgent also
  // applies the agent's system prompt + tool allowlist + thinking level.
  // Intake keeps its dedicated INTAKE_SYSTEM_PROMPT and proposeSession flow.
  const agentName = settings.agent ?? DEFAULT_AGENT_NAME;
  const agent = await resolveSessionAgent(project.cwd, agentName);
  const agentRuleset = agent.permission ?? fromConfig({ "*": "allow" });
  harness.setPermissionEvaluator(buildPermissionEvaluator(agentRuleset));
  if (!isIntake) {
    await harness.switchAgent(agent);
  }
  ctx.log?.agent.debug("agent resolved", { sessionId, agent: agent.name });

  const unsubscribe = harness.subscribe((event) => {
    eventCallback(event);
  });

  // Abort controller spanning the full run, including the retry backoff sleep.
  // abortRun() aborts this so a user cancel interrupts the retry sequence
  // even when the harness itself is idle between turns.
  const retryAbort = new AbortController();

  if (!registerRun(sessionId, harness, unsubscribe, retryAbort)) {
    unsubscribe();
    throw new Error(busyMessage(sessionId));
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

  try {
    // Application-level retry: run the turn, and on a transient failure emit
    // auto_retry_start/end events, roll the session leaf back past the failed
    // message, back off, and re-run via harness.continue(). See retry-loop.ts.
    const retrySettings = parseRetrySettings(settings);
    let firstTurn = true;
    await executeWithRetry(
      {
        signal: retryAbort.signal,
        emit: (event) => eventCallback(event),
        ...(ctx.log === undefined ? {} : { logger: ctx.log.agent }),
        // Move the session leaf to the failed message's parent, orphaning the
        // failed assistant message so the next turn re-runs from the prior
        // user/toolResult message (same mechanism as session branching).
        rollbackLeaf: async () => {
          // Orphan the failed assistant message by moving the leaf to its
          // parent, so continue() re-runs from the preceding user/toolResult
          // message. Assumes the failed turn appended exactly one entry —
          // which holds for the transient provider errors we retry (429/5xx
          // fail at the request, before any tools execute). shouldRetry only
          // classifies stopReason === "error" messages, so non-transient or
          // tool-producing turns never reach here.
          const branch = await sessionInstance.getBranch();
          const lastEntry = branch.at(-1);
          if (lastEntry?.parentId) {
            await sessionInstance.getStorage().setLeafId(lastEntry.parentId);
          }
        },
        // The first turn is a fresh prompt; subsequent turns continue from the
        // rolled-back transcript (no new user message).
        runTurn: async () => {
          if (firstTurn) {
            firstTurn = false;
            ctx.log?.agent.info("turn prompt", {
              sessionId,
              messageLength: message.length,
            });
            return harness.prompt(message);
          }
          ctx.log?.agent.info("turn retry", { sessionId });
          return harness.continue();
        },
      },
      retrySettings
    );
  } catch (err) {
    ctx.log?.agent.error("run failed", err, { sessionId });
    throw err;
  } finally {
    ctx.log?.agent.info("run finished", { sessionId });
    unregisterRun(sessionId);
  }
}
