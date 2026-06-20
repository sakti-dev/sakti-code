import type { AgentEvent, SessionStore } from "@sakti-code/agent";
import { createAgentLoop } from "@sakti-code/agent";
import type { ServerContext } from "../context.ts";
import { resolveModel } from "./model-resolver.ts";
import { buildTools } from "./tools-builder.ts";

const activeRuns = new Map<string, AbortController>();

export function registerRun(sessionId: string, controller: AbortController) {
  activeRuns.set(sessionId, controller);
}

export function unregisterRun(sessionId: string) {
  activeRuns.delete(sessionId);
}

export function abortRun(sessionId: string): boolean {
  const controller = activeRuns.get(sessionId);
  if (controller) {
    controller.abort();
    return true;
  }
  return false;
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

  const controller = new AbortController();
  registerRun(sessionId, controller);

  try {
    const loop = createAgentLoop({
      sessionId,
      model,
      tools,
      store,
    });

    yield* loop.prompt(message, controller.signal);
  } finally {
    unregisterRun(sessionId);
  }
}
