import { relative, resolve } from "node:path";
import { errMsg, validateArgs } from "../lib/shared.ts";
import { RG_BIN, runCommand, shellQuote } from "../lib/shell.ts";
import type { ToolDefinition } from "../lib/types.ts";

export function createGrepTool(cwd: string): ToolDefinition {
  return {
    name: "grep",
    description: "Search file contents using ripgrep.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern" },
        path: {
          type: "string",
          description: "Directory to search in (relative to cwd)",
        },
        ignoreCase: { type: "boolean", description: "Case insensitive search" },
        limit: { type: "number", description: "Max matches (default 100)" },
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
          ignoreCase: { type: "boolean" },
          limit: { type: "number" },
        },
        "grep"
      );
      if (!v.valid) {
        return { content: v.error, terminate: false, isError: true };
      }
      const { pattern, path, ignoreCase, limit } = v.args as {
        pattern: string;
        path?: string;
        ignoreCase?: boolean;
        limit?: number;
      };
      const searchDir = shellQuote(resolve(cwd, path ?? "."));
      const maxMatches = limit ?? 100;
      const icFlag = ignoreCase ? " -i" : "";

      try {
        const result = runCommand(
          `${RG_BIN} --no-heading -n${icFlag} --max-count ${maxMatches} ${shellQuote(pattern)} ${searchDir}`,
          cwd,
          30_000
        );

        const lines = result.trim().split("\n").filter(Boolean);
        if (lines.length === 0) {
          return { content: "No matches found.", terminate: false };
        }

        const matches = lines.map((line) => {
          const colonIdx = line.indexOf(":");
          const filePath = line.slice(0, colonIdx);
          const rest = line.slice(colonIdx + 1);
          return `${relative(cwd, filePath)}:${rest}`;
        });

        return { content: matches.join("\n"), terminate: false };
      } catch (err: unknown) {
        if (err instanceof Error && "status" in err && err.status === 1) {
          return { content: "No matches found.", terminate: false };
        }
        return {
          content: `grep error: ${errMsg(err).slice(0, 200)}`,
          terminate: false,
          isError: true,
        };
      }
    },
  };
}
