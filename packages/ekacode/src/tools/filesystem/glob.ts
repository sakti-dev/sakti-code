/**
 * Glob files tool
 */

import { createTool } from "@mastra/core/tools";
import { glob } from "glob";
import path from "node:path";
import { z } from "zod";
import { WorkspaceInstance } from "../../workspace/instance";

export const globTool = createTool({
  id: "glob-files",
  description: `Find files matching a glob pattern.

- Uses standard glob syntax (e.g., 'src/**/*.ts')
- Searches from workspace root
- Returns paths relative to workspace
- Limited to 100 results by default`,

  inputSchema: z.object({
    pattern: z.string().describe("Glob pattern (e.g., 'src/**/*.ts')"),
    limit: z.coerce
      .number()
      .min(1)
      .max(1000)
      .optional()
      .describe("Maximum number of results (default: 100)"),
  }),

  outputSchema: z.object({
    files: z.array(z.string()),
    count: z.number(),
    pattern: z.string(),
  }),

  execute: async ({ pattern, limit = 100 }) => {
    const workspace = WorkspaceInstance.getInstance();

    const files = await glob(pattern, {
      cwd: workspace.root,
      absolute: false,
    });

    // Apply limit manually
    const limitedFiles = files.slice(0, limit);

    return {
      files: limitedFiles.map(f => path.relative(workspace.root, f)),
      count: limitedFiles.length,
      pattern,
    };
  },
});
