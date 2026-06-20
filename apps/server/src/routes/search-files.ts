import { Elysia, t } from "elysia";
import { getCtx } from "../context.ts";

interface FileEntry {
  kind: "file" | "directory";
  path: string;
}

async function runFd(
  query: string | null,
  cwd: string,
  limit: number
): Promise<FileEntry[]> {
  try {
    const args: string[] = [
      "--type",
      "f",
      "--type",
      "d",
      "--max-results",
      String(limit),
      "--color",
      "never",
    ];
    if (query) {
      args.push(query);
    }
    const proc = Bun.spawn(["fd", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    const output = await new Response(proc.stdout).text();
    const lines = output.split("\n").filter(Boolean).slice(0, limit);
    return lines.map((p) => ({
      path: p.endsWith("/") ? p.slice(0, -1) : p,
      kind: p.endsWith("/") ? ("directory" as const) : ("file" as const),
    }));
  } catch {
    return [];
  }
}

async function runFind(
  query: string | null,
  cwd: string,
  limit: number
): Promise<FileEntry[]> {
  try {
    const ignoreDirs = [
      "node_modules",
      ".git",
      ".cache",
      "dist",
      "build",
      ".next",
    ];
    const ignoreDirsExpr = ignoreDirs.flatMap((d) => [
      "-not",
      "-path",
      `*/${d}/*`,
    ]);

    const args: string[] = [".", "-type", "f"];
    if (query) {
      const escaped = query.replace(/[.*?[\]()]/g, "\\$&");
      args.push("-name", `*${escaped}*`);
    }
    args.push(...ignoreDirsExpr);

    const proc = Bun.spawn(["find", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    await proc.exited;
    const output = await new Response(proc.stdout).text();
    return output
      .split("\n")
      .filter(Boolean)
      .slice(0, limit)
      .map((p) => ({
        path: p,
        kind: "file" as const,
      }));
  } catch {
    return [];
  }
}

export const searchFilesRoutes = new Elysia({ name: "routes.searchFiles" }).get(
  "/api/projects/:id/search-files",
  async ({ params, query: { q, limit }, store }) => {
    const ctx = getCtx(store);
    const project = await ctx.repos.projects.findById(params.id);
    if (!project) {
      return new Response("Not found", { status: 404 });
    }

    const query = q ?? null;
    const maxResults = Math.min(limit ?? 20, 100);

    let files: FileEntry[];
    files = await runFd(query, project.cwd, maxResults);
    if (files.length === 0) {
      // Fallback to find
      files = await runFind(query, project.cwd, maxResults);
    }

    return Response.json({ files, projectId: project.id, cwd: project.cwd });
  },
  {
    query: t.Object({
      q: t.Optional(t.String()),
      limit: t.Optional(t.Numeric()),
    }),
  }
);
