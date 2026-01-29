/**
 * Glob files tool
 */

import { tool, zodSchema } from "ai";
import { glob } from "glob";
import path from "node:path";
import { z } from "zod";
import { PermissionManager } from "../../security/permission-manager";
import { getContextOrThrow } from "../base/context";
import { validatePathOperation } from "../base/safety";

export const globTool = tool({
  description: `Find files matching a glob pattern.

- Uses standard glob syntax (e.g., 'src/**/*.ts')
- Searches from workspace root
- Returns paths relative to workspace
- Limited to 100 results by default`,

  inputSchema: zodSchema(
    z.object({
      pattern: z.string().describe("Glob pattern (e.g., 'src/**/*.ts')"),
      limit: z.coerce
        .number()
        .min(1)
        .max(1000)
        .optional()
        .describe("Maximum number of results (default: 100)"),
    })
  ),

  outputSchema: zodSchema(
    z.object({
      files: z.array(z.string()),
      count: z.number(),
      pattern: z.string(),
    })
  ),

  execute: async ({ pattern, limit = 100 }) => {
    // Get context with enhanced error message
    const { directory, sessionID } = getContextOrThrow();
    const permissionMgr = PermissionManager.getInstance();

    if (path.isAbsolute(pattern)) {
      throw new Error("Glob pattern must be relative to the workspace root");
    }

    const traversalPattern = /(^|[\\/])\.\.(?=$|[\\/])/;
    if (traversalPattern.test(pattern)) {
      throw new Error("Glob pattern cannot traverse outside the workspace");
    }

    // Validate workspace read permission
    await validatePathOperation(directory, directory, "read", permissionMgr, sessionID, {
      always: ["*"],
    });

    const files = await glob(pattern, {
      cwd: directory,
      absolute: false,
    });

    // Apply limit manually
    const limitedFiles = files.slice(0, limit);

    return {
      files: limitedFiles,
      count: limitedFiles.length,
      pattern,
    };
  },
});
