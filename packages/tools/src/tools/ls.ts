import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { errMsg, validateArgs } from "../lib/shared.ts";
import type { ToolDefinition } from "../lib/types.ts";

export function createLsTool(cwd: string): ToolDefinition {
  return {
    name: "ls",
    description: "List directory contents.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Directory to list (relative to cwd, default is cwd)",
        },
        limit: { type: "number", description: "Max entries (default 500)" },
      },
    },
    execute: async (_id, args) => {
      const v = validateArgs(
        args as Record<string, unknown>,
        { path: { type: "string" }, limit: { type: "number" } },
        "ls"
      );
      if (!v.valid) {
        return { content: v.error, terminate: false, isError: true };
      }
      const { path, limit } = v.args as { path?: string; limit?: number };
      const dirPath = resolve(cwd, path ?? ".");
      const maxEntries = limit ?? 500;

      try {
        const entries = await readdir(dirPath, { withFileTypes: true });
        const sorted = entries
          .sort((a, b) => {
            // Directories first
            if (a.isDirectory() && !b.isDirectory()) {
              return -1;
            }
            if (!a.isDirectory() && b.isDirectory()) {
              return 1;
            }
            return a.name.localeCompare(b.name);
          })
          .slice(0, maxEntries)
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));

        return { content: sorted.join("\n"), terminate: false };
      } catch (err: unknown) {
        return {
          content: `ls error: ${errMsg(err).slice(0, 200)}`,
          terminate: false,
          isError: true,
        };
      }
    },
  };
}
