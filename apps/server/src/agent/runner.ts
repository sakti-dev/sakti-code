import { getEnvApiKey } from "@earendil-works/pi-ai";
import type {
  AgentHarness,
  AgentHarnessEvent,
  QueueMode,
  SessionStorage,
  ThinkingLevel,
} from "@sakti-code/agent";
import {
  AgentHarness as HarnessClass,
  Session as SessionClass,
} from "@sakti-code/agent";
import type { ServerContext } from "../context.ts";
import { BunExecutionEnv } from "./execution-env.ts";
import { resolveModel } from "./model-resolver.ts";
import { buildTools } from "./tools-builder.ts";

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

  const { model, provider } = resolveModel(ctx, session);
  const tools = buildTools(project.cwd);

  const settings = loadSessionSettings(ctx, sessionId);
  const thinkingLevel = resolveThinkingLevel(ctx, sessionId, session);

  const env = new BunExecutionEnv(project.cwd);
  const sessionInstance = new SessionClass(storage);
  const getApiKeyAndHeaders = async (): Promise<
    { apiKey: string; headers?: Record<string, string> } | undefined
  > => {
    const key = getEnvApiKey(provider);
    if (!key) {
      return;
    }
    return { apiKey: key };
  };

  const harness = new HarnessClass({
    env,
    model,
    session: sessionInstance,
    tools,
    ...(settings.follow_up_mode === undefined
      ? {}
      : { followUpMode: settings.follow_up_mode as QueueMode }),
    ...(settings.steering_mode === undefined
      ? {}
      : { steeringMode: settings.steering_mode as QueueMode }),
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
