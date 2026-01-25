/**
 * Multi-edit tool
 */

import { createTool } from "@mastra/core/tools";
import { nanoid } from "nanoid";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { PermissionManager } from "../../security/permission-manager";
import { WorkspaceInstance } from "../../workspace/instance";
import { assertExternalDirectory } from "../base/filesystem";

export const multieditTool = createTool({
  id: "multi-edit",
  description: `Apply multiple edits to a single file in sequence.

- Edits are applied in the order specified
- Each edit uses the same logic as the edit tool
- If any edit fails (string not found), the entire operation fails`,

  inputSchema: z.object({
    filePath: z.string().describe("Absolute path to the file"),
    edits: z
      .array(
        z.object({
          oldString: z.string(),
          newString: z.string(),
          replaceAll: z.boolean().optional(),
        })
      )
      .min(1)
      .describe("Array of edit operations to apply sequentially"),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    filePath: z.string(),
    totalReplacements: z.number(),
    results: z.array(
      z.object({
        replacements: z.number(),
      })
    ),
  }),

  execute: async ({ filePath, edits }, context) => {
    const workspace = WorkspaceInstance.getInstance();
    const permissionMgr = PermissionManager.getInstance();
    const sessionID = (context as { sessionID?: string })?.sessionID || nanoid();

    // Resolve path
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(workspace.root, filePath);

    await assertExternalDirectory(absolutePath, workspace.root, async (perm, patterns) => {
      return permissionMgr.requestApproval({
        id: nanoid(),
        permission: perm,
        patterns,
        always: [],
        sessionID,
      });
    });

    // Check edit permission once for all edits
    await permissionMgr.requestApproval({
      id: nanoid(),
      permission: "edit",
      patterns: [workspace.getRelativePath(absolutePath)],
      always: [],
      sessionID,
    });

    let content = await fs.readFile(absolutePath, "utf-8");

    const results: Array<{ replacements: number }> = [];
    let totalReplacements = 0;

    for (const edit of edits) {
      let replacements = 0;
      const { oldString, newString, replaceAll = false } = edit;

      if (replaceAll) {
        const count = content.split(oldString).length - 1;
        content = content.split(oldString).join(newString);
        replacements = count;
      } else {
        const index = content.indexOf(oldString);
        if (index !== -1) {
          content =
            content.substring(0, index) + newString + content.substring(index + oldString.length);
          replacements = 1;
        }
      }

      if (replacements === 0) {
        throw new Error(`String not found in file: "${oldString.slice(0, 50)}..."`);
      }

      results.push({ replacements });
      totalReplacements += replacements;
    }

    await fs.writeFile(absolutePath, content, "utf-8");

    return {
      success: true,
      filePath: workspace.getRelativePath(absolutePath),
      totalReplacements,
      results,
    };
  },
});
