import { relative, resolve } from "node:path";
import { errMsg, validateArgs } from "../lib/shared.ts";
import { FD_BIN, runCommand, shellQuote } from "../lib/shell.ts";
import type { ToolDefinition } from "../lib/types.ts";

export function createFindTool(cwd: string): ToolDefinition {
  return {
    name: "find",
    description: "Locate files using fd.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern (e.g. *.ts)" },
        path: {
          type: "string",
          description: "Directory to search (relative to cwd)",
        },
        limit: { type: "number", description: "Max results (default 1000)" },
      },
      required: ["pattern"],
    },
    // biome-ignore lint/suspicious/useAwait: interface requires async; execSync is synchronous
    execute: async (_id, args) => {
      const v = validateArgs(
        args as Record<string, unknown>,
        {
          pattern: { type: "string", required: true },
          path: { type: "string" },
          limit: { type: "number" },
        },
        "find"
      );
      if (!v.valid) {
        return { content: v.error, terminate: false, isError: true };
      }
      const { pattern, path, limit } = v.args as {
        pattern: string;
        path?: string;
        limit?: number;
      };
      const searchDir = shellQuote(resolve(cwd, path ?? "."));
      const maxResults = limit ?? 1000;

      try {
        const result = runCommand(
          `${FD_BIN} --glob ${shellQuote(pattern)} --hidden --no-require-git --max-results ${maxResults} ${searchDir}`,
          cwd,
          15_000
        );

        const files = result
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((f) => relative(cwd, f));
        if (files.length === 0) {
          return { content: "No files found.", terminate: false };
        }

        return { content: files.join("\n"), terminate: false };
      } catch (err: unknown) {
        if (err instanceof Error && "status" in err && err.status === 1) {
          return { content: "No files found.", terminate: false };
        }
        const stderr =
          err instanceof Error && "stderr" in err ? String(err.stderr) : "";
        return {
          content: `find error: ${stderr.slice(0, 200) || errMsg(err).slice(0, 200)}`,
          terminate: false,
          isError: true,
        };
      }
    },
  };
}
