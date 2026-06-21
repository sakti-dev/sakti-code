import { Elysia, t } from "elysia";
import { getCtx } from "../context.ts";

const BASH_TIMEOUT_MS = 30_000;
const BASH_OUTPUT_LIMIT = 100_000; // 100 KB

// Active bash processes tracked by session ID
const activeBash = new Map<
  string,
  { process: Bun.Subprocess; startedAt: number }
>();

// Tracks whether a process was cancelled by abort (vs timeout)
const cancelledFlags = new Map<string, boolean>();

export interface BashResult {
  cancelled: boolean;
  exitCode: number | null;
  output: string;
  truncated: boolean;
}

async function runBash(
  command: string,
  cwd: string,
  sessionId: string,
  timeoutMs: number = BASH_TIMEOUT_MS
): Promise<BashResult> {
  let proc: Bun.Subprocess | null = null;
  try {
    proc = Bun.spawn(["/bin/sh", "-c", command], {
      cwd,
      env: { ...process.env },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch {
    return {
      cancelled: false,
      exitCode: -1,
      output: "Failed to spawn shell",
      truncated: false,
    };
  }

  // Register for abort
  activeBash.set(sessionId, { process: proc, startedAt: Date.now() });
  cancelledFlags.set(sessionId, false);

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    if (proc) {
      proc.kill();
    }
  }, timeoutMs);

  const code = await proc.exited;
  clearTimeout(timer);

  // Check if aborted via abort-bash endpoint
  const wasCancelled = cancelledFlags.get(sessionId) ?? false;
  activeBash.delete(sessionId);
  cancelledFlags.delete(sessionId);

  if (timedOut) {
    return {
      cancelled: true,
      exitCode: null,
      output: `[Command timed out after ${timeoutMs / 1000}s]`,
      truncated: false,
    };
  }

  if (wasCancelled) {
    const stdout = await new Response(
      proc.stdout as ReadableStream<Uint8Array>
    ).text();
    const stderr = await new Response(
      proc.stderr as ReadableStream<Uint8Array>
    ).text();
    return {
      cancelled: true,
      exitCode: code,
      output: (stdout + stderr).trim() || "(no output)",
      truncated: false,
    };
  }

  // Normal completion
  const stdout = await new Response(
    proc.stdout as ReadableStream<Uint8Array>
  ).text();
  const stderr = await new Response(
    proc.stderr as ReadableStream<Uint8Array>
  ).text();
  const combined = stdout + stderr;
  const truncated = combined.length > BASH_OUTPUT_LIMIT;
  const output = truncated ? combined.slice(0, BASH_OUTPUT_LIMIT) : combined;
  return {
    cancelled: false,
    exitCode: code,
    output: output.length > 0 ? output : "(no output)",
    truncated,
  };
}

const bashBody = t.Object({
  command: t.String(),
  injectToContext: t.Optional(t.Boolean()),
  timeout: t.Optional(t.Number()),
});

export const bashRoutes = new Elysia({ name: "routes.bash" })
  .post(
    "/api/sessions/:id/bash",
    async ({ params, body, store }) => {
      const ctx = getCtx(store);
      const session = await ctx.repos.sessions.findById(params.id);
      if (!session) {
        return new Response("Not found", { status: 404 });
      }
      const project = await ctx.repos.projects.findById(session.projectId);
      if (!project) {
        return new Response("Project not found", { status: 500 });
      }

      const result = await runBash(
        body.command,
        project.cwd,
        params.id,
        // body.timeout is in SECONDS (per spec); convert to ms. Default 30s.
        body.timeout === undefined ? undefined : body.timeout * 1000
      );

      if (body.injectToContext) {
        const content = JSON.stringify({
          command: body.command,
          exitCode: result.exitCode,
          output: result.output,
        });
        await ctx.repos.messages.append(session.id, {
          content,
          role: "tool",
          toolCallId: crypto.randomUUID(),
          toolName: "user_bash",
        });
      }

      return result;
    },
    { body: bashBody }
  )
  .post("/api/sessions/:id/abort-bash", async ({ params, store }) => {
    const ctx = getCtx(store);
    const session = await ctx.repos.sessions.findById(params.id);
    if (!session) {
      return new Response("Not found", { status: 404 });
    }
    const entry = activeBash.get(params.id);
    if (entry) {
      cancelledFlags.set(params.id, true);
      entry.process.kill();
      activeBash.delete(params.id);
    }
    return { ok: true };
  });
