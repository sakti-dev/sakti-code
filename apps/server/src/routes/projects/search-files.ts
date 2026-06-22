import { Hono } from "hono";
import { getCtx } from "../../context.ts";
import { spawnPiped } from "../../lib/spawn.ts";

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
    const { done } = spawnPiped("fd", args, { cwd });
    const result = await done;
    if (result.spawnError) {
      return [];
    }
    const lines = result.stdout.split("\n").filter(Boolean).slice(0, limit);
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
      "dist",
      "build",
      ".cache",
      ".next",
      "__pycache__",
      ".DS_Store",
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

    const { done } = spawnPiped("find", args, { cwd });
    const result = await done;
    if (result.spawnError) {
      return [];
    }
    return result.stdout
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

export const searchFilesRoutes = new Hono()
  .basePath("/projects")
  .get("/:id/files", async (c) => {
    const ctx = getCtx(c);
    const project = await ctx.repos.projects.findById(c.req.param("id"));
    if (!project) {
      return c.json({ error: "Not found" }, 404);
    }

    const q = c.req.query("query") ?? null;
    const rawLimit = c.req.query("limit");
    const parsedLimit = rawLimit === undefined ? undefined : Number(rawLimit);
    const maxResults = Math.min(
      parsedLimit === undefined || !Number.isFinite(parsedLimit)
        ? 20
        : parsedLimit,
      100
    );

    let files: FileEntry[] = await runFd(q, project.cwd, maxResults);
    if (files.length === 0) {
      files = await runFind(q, project.cwd, maxResults);
    }

    return c.json({ files, cwd: project.cwd });
  });
