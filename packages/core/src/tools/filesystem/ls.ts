/**
 * List directory tool
 */

import { tool, zodSchema } from "ai";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { PermissionManager } from "../../security/permission-manager";
import { getContextOrThrow } from "../base/context";
import { validatePathOperation } from "../base/safety";

export const lsTool = tool({
  description: `List directory contents.

- Returns files and directories in the specified path
- Supports recursive listing
- Paths are relative to workspace root in output`,

  inputSchema: zodSchema(
    z.object({
      dirPath: z.string().describe("Path to the directory"),
      recursive: z.boolean().optional().describe("List recursively (default: false)"),
    })
  ),

  outputSchema: zodSchema(
    z.object({
      entries: z.array(
        z.object({
          name: z.string(),
          path: z.string(),
          type: z.enum(["file", "directory"]),
        })
      ),
      count: z.number(),
    })
  ),

  execute: async ({ dirPath, recursive = false }) => {
    // Get context with enhanced error message
    const { directory, sessionID } = getContextOrThrow();
    const permissionMgr = PermissionManager.getInstance();

    // Validate path operation and get safe paths
    const { absolutePath } = await validatePathOperation(
      dirPath,
      directory,
      "read",
      permissionMgr,
      sessionID,
      { always: ["*"] }
    );

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
            path: path.relative(directory, fullPath),
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
