/**
 * List directory tool
 */

import { createTool } from "@mastra/core/tools";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { WorkspaceInstance } from "../../workspace/instance";

export const lsTool = createTool({
  id: "list-directory",
  description: `List directory contents.

- Returns files and directories in the specified path
- Supports recursive listing
- Paths are relative to workspace root in output`,

  inputSchema: z.object({
    dirPath: z.string().describe("Path to the directory"),
    recursive: z.boolean().optional().describe("List recursively (default: false)"),
  }),

  outputSchema: z.object({
    entries: z.array(
      z.object({
        name: z.string(),
        path: z.string(),
        type: z.enum(["file", "directory"]),
      })
    ),
    count: z.number(),
  }),

  execute: async ({ dirPath, recursive = false }) => {
    const workspace = WorkspaceInstance.getInstance();
    const absolutePath = path.isAbsolute(dirPath) ? dirPath : path.join(workspace.root, dirPath);

    const entries: Array<{
      name: string;
      path: string;
      type: "file" | "directory";
    }> = [];

    async function traverse(currentPath: string) {
      try {
        const items = await fs.readdir(currentPath, { withFileTypes: true });

        for (const item of items) {
          const fullPath = path.join(currentPath, item.name);
          entries.push({
            name: item.name,
            path: workspace.getRelativePath(fullPath),
            type: item.isDirectory() ? "directory" : "file",
          });

          if (recursive && item.isDirectory()) {
            await traverse(fullPath);
          }
        }
      } catch (error: unknown) {
        if (!(error instanceof Object && "code" in error && error.code === "ENOENT")) {
          throw error;
        }
      }
    }

    await traverse(absolutePath);

    return {
      entries,
      count: entries.length,
    };
  },
});
