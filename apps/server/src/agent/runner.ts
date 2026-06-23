import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type {
  AgentHarness,
  AgentHarnessEvent,
  QueueMode,
  SessionStorage,
  ThinkingLevel,
} from "@sakti-code/agent";
import {
  AgentHarness as HarnessClass,
  INTAKE_SYSTEM_PROMPT,
  Session as SessionClass,
} from "@sakti-code/agent";
import { createProposeSessionTool } from "@sakti-code/tools";
import type { ServerContext } from "../context.ts";
import { NodeExecutionEnv } from "./execution-env.ts";
import { resolveAuth, resolveModel } from "./model-resolver.ts";
import { type ReplayEntry, ReplayRunner } from "./replay-runner.ts";
import { buildTools } from "./tools-builder.ts";
import type { WsHandle } from "./ws-handler.ts";

interface ActiveRun {
  harness: AgentHarness;
  unsubscribe: () => void;
}

const activeRuns = new Map<string, ActiveRun>();

export function busyMessage(sessionId: string): string {
  return `A run is already active for session ${sessionId}. Send a 'steer' or 'followUp' message to queue input, or 'abort' to cancel the active run first.`;
}

export function registerRun(
  sessionId: string,
  harness: AgentHarness,
  unsubscribe: () => void
): boolean {
  if (activeRuns.has(sessionId)) {
    return false;
  }
  activeRuns.set(sessionId, { harness, unsubscribe });
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
  session: { thinkingLevel: string }
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
  return "off";
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

  const project = await ctx.repos.projects.findById(session.projectId);
  if (!project) {
    throw new Error(`Project not found: ${session.projectId}`);
  }

  const auth = resolveAuth(ctx, session);
  if (!auth) {
    throw new Error(
      `No API key for ${resolveModel(ctx, session).provider} in env`
    );
  }
  const { model } = auth;
  const isIntake = session.kind === "intake";
  const tools = buildTools(project.cwd);
  if (isIntake) {
    tools.push(createProposeSessionTool());
  }

  const settings = loadSessionSettings(ctx, sessionId);
  const thinkingLevel = resolveThinkingLevel(ctx, sessionId, session);

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
    tools,
    followUpMode: settings.follow_up_mode as QueueMode,
    steeringMode: settings.steering_mode as QueueMode,
    thinkingLevel,
    getApiKeyAndHeaders,
  });

  const unsubscribe = harness.subscribe((event) => {
    eventCallback(event);
  });

  if (!registerRun(sessionId, harness, unsubscribe)) {
    unsubscribe();
    throw new Error(busyMessage(sessionId));
  }

  try {
    await harness.prompt(message);
  } finally {
    unregisterRun(sessionId);
  }
}
