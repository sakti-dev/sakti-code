import { getEnvApiKey } from "@earendil-works/pi-ai";
import type { AgentEvent, AgentLoop, SessionStore } from "@sakti-code/agent";
import { createAgentLoop } from "@sakti-code/agent";
import type { ServerContext } from "../context.ts";
import { resolveModel } from "./model-resolver.ts";
import { buildTools } from "./tools-builder.ts";

interface ActiveRun {
  controller: AbortController;
  loop: AgentLoop;
}

const activeRuns = new Map<string, ActiveRun>();

export function busyMessage(sessionId: string): string {
  return `A run is already active for session ${sessionId}. Send a 'steer' or 'followUp' message to queue input, or 'abort' to cancel the active run first.`;
}

export function registerRun(
  sessionId: string,
  controller: AbortController,
  loop: AgentLoop
): boolean {
  if (activeRuns.has(sessionId)) {
    return false;
  }
  activeRuns.set(sessionId, { controller, loop });
  return true;
}

export function unregisterRun(sessionId: string) {
  activeRuns.delete(sessionId);
}

export function isRunActive(sessionId: string): boolean {
  return activeRuns.has(sessionId);
}

export function clearRunsForTesting(): void {
  activeRuns.clear();
}

export function abortRun(sessionId: string): boolean {
  const run = activeRuns.get(sessionId);
  if (run) {
    run.controller.abort();
    return true;
  }
  return false;
}

export function getActiveLoop(sessionId: string): AgentLoop | null {
  const run = activeRuns.get(sessionId);
  return run?.loop ?? null;
}

// Default per-session setting values
const DEFAULT_SETTINGS: Record<string, string> = {
  auto_compaction: "false",
  auto_retry: "true",
  follow_up_mode: "all",
  max_retries: "3",
  steering_mode: "all",
  thinking_level: "off",
};

/** Load per-session settings and merge with defaults. */
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

export async function* runPrompt(
  ctx: ServerContext,
  sessionId: string,
  message: string,
  store: SessionStore
): AsyncGenerator<AgentEvent> {
  const session = await ctx.repos.sessions.findById(sessionId);
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const project = await ctx.repos.projects.findById(session.projectId);
  if (!project) {
    throw new Error(`Project not found: ${session.projectId}`);
  }

  const model = resolveModel(ctx, session);
  const tools = buildTools(project.cwd);

  // Resolve the provider API key for the summarization LLM call (same pattern
  // as the manual /compact route). The agent package is pure, so the key must
  // be supplied here via AgentConfig.apiKey.
  const modelConfig = ctx.repos.models.getForProject(session.projectId);
  const provider = modelConfig?.provider ?? "";
  const apiKey = getEnvApiKey(provider) ?? undefined;

  // Load per-session settings
  const settings = loadSessionSettings(ctx, sessionId);
  // Distinguish "thinking_level key absent" (fall back to the session row) from
  // "key explicitly present" (authoritative, including the value "off"). The
  // merged defaults can't tell the two apart, so read the raw row.
  const thinkingLevelRow = ctx.repos.settings.get(
    `session:${sessionId}:thinking_level`
  );
  let thinkingLevel: string | undefined;
  if (thinkingLevelRow !== null) {
    thinkingLevel = thinkingLevelRow === "off" ? undefined : thinkingLevelRow;
  } else if (session.thinkingLevel !== "off") {
    thinkingLevel = session.thinkingLevel;
  }

  const controller = new AbortController();

  const loop = createAgentLoop({
    ...(apiKey === undefined ? {} : { apiKey }),
    autoCompaction: settings.auto_compaction === "true",
    autoRetry: settings.auto_retry === "true",
    followUpMode: settings.follow_up_mode,
    maxRetries: Number(settings.max_retries),
    model,
    sessionId,
    steeringMode: settings.steering_mode,
    store,
    thinkingLevel,
    tools,
  });

  if (!registerRun(sessionId, controller, loop)) {
    throw new Error(busyMessage(sessionId));
  }

  try {
    yield* loop.prompt(message, controller.signal);
  } finally {
    unregisterRun(sessionId);
  }
}
