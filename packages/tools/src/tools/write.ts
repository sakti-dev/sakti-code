import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { validateArgs } from "../lib/shared.ts";
import type { ToolDefinition } from "../lib/types.ts";

export function createWriteTool(cwd: string): ToolDefinition {
  return {
    name: "write",
    description:
      "Write content to a file. Creates parent directories if needed.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to cwd" },
        content: { type: "string", description: "Content to write" },
      },
      required: ["path", "content"],
    },
    execute: async (_id, args) => {
      const v = validateArgs(
        args as Record<string, unknown>,
        {
          path: { type: "string", required: true },
          content: { type: "string", required: true },
        },
        "write"
      );
      if (!v.valid) {
        return { content: v.error, terminate: false, isError: true };
      }
      const { path, content } = v.args as { path: string; content: string };
      const filePath = resolve(cwd, path);

      const dir = join(filePath, "..");
      await mkdir(dir, { recursive: true });
      await writeFile(filePath, content, "utf-8");

      return {
        content: `Wrote ${Buffer.byteLength(content, "utf-8")} bytes to ${path}`,
        terminate: false,
      };
    },
  };
}
