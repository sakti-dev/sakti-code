/**
 * Edit file tool
 */

import { createLogger } from "@ekacode/logger";
import { createTool } from "@mastra/core/tools";
import { nanoid } from "nanoid";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { PermissionManager } from "../../security/permission-manager";
import { WorkspaceInstance } from "../../workspace/instance";
import { assertExternalDirectory } from "../base/filesystem";

const logger = createLogger("ekacode");

export const editTool = createTool({
  id: "edit-file",
  description: `Edit a file by replacing text.

- Replaces occurrences of oldString with newString
- For replaceAll=false, replaces only the first occurrence
- For replaceAll=true, replaces all occurrences
- Use exact text matching from the source file
- For multiple edits, use the multiedit tool`,

  inputSchema: z.object({
    filePath: z.string().describe("Absolute path to the file"),
    oldString: z.string().describe("Exact text to replace"),
    newString: z.string().describe("Replacement text"),
    replaceAll: z.boolean().optional().describe("Replace all occurrences (default: false)"),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    filePath: z.string(),
    replacements: z.number(),
  }),

  execute: async ({ filePath, oldString, newString, replaceAll = false }, context) => {
    const workspace = WorkspaceInstance.getInstance();
    const permissionMgr = PermissionManager.getInstance();
    const sessionID = (context as { sessionID?: string })?.sessionID || nanoid();
    const toolLogger = logger.child({ module: "tool:edit", tool: "edit", sessionID });

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

    // Check edit permission
    await permissionMgr.requestApproval({
      id: nanoid(),
      permission: "edit",
      patterns: [workspace.getRelativePath(absolutePath)],
      always: [],
      sessionID,
    });

    let content = await fs.readFile(absolutePath, "utf-8");

    let replacements = 0;
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
      toolLogger.warn("String not found in file", {
        path: workspace.getRelativePath(absolutePath),
        search: oldString.slice(0, 50),
      });
      throw new Error(`String not found in file: "${oldString.slice(0, 50)}..."`);
    }

    await fs.writeFile(absolutePath, content, "utf-8");

    toolLogger.info("File edited successfully", {
      path: workspace.getRelativePath(absolutePath),
      replacements,
      replaceAll,
    });

    return {
      success: true,
      filePath: workspace.getRelativePath(absolutePath),
      replacements,
    };
  },
});
