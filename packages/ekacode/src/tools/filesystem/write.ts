/**
 * Write file tool
 */

import { createLogger } from "@ekacode/logger";
import { createTool } from "@mastra/core/tools";
import { createTwoFilesPatch } from "diff";
import { nanoid } from "nanoid";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { PermissionManager } from "../../security/permission-manager";
import { WorkspaceInstance } from "../../workspace/instance";
import { assertExternalDirectory } from "../base/filesystem";

const logger = createLogger("ekacode");

export const writeTool = createTool({
  id: "write-file",
  description: `Write content to a file.

- Creates parent directories automatically
- Shows unified diff before writing
- Requires permission for file modifications
- Overwrites existing files if they exist`,

  inputSchema: z.object({
    content: z.string().describe("Content to write to the file"),
    filePath: z.string().describe("Absolute path to the file"),
  }),

  outputSchema: z.object({
    success: z.boolean(),
    filePath: z.string(),
    diff: z.string(),
    created: z.boolean(),
  }),

  execute: async ({ content, filePath }, context) => {
    const workspace = WorkspaceInstance.getInstance();
    const permissionMgr = PermissionManager.getInstance();
    const sessionID = (context as { sessionID?: string })?.sessionID || nanoid();
    const toolLogger = logger.child({ module: "tool:write", tool: "write", sessionID });

    // Resolve path
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(workspace.root, filePath);

    // Check external directory permission
    await assertExternalDirectory(absolutePath, workspace.root, async (permission, patterns) => {
      return permissionMgr.requestApproval({
        id: nanoid(),
        permission,
        patterns,
        always: [],
        sessionID,
      });
    });

    // Check if file exists
    const exists = await fs
      .access(absolutePath)
      .then(() => true)
      .catch(() => false);
    const oldContent = exists ? await fs.readFile(absolutePath, "utf-8") : "";

    // Generate diff
    const diff = createTwoFilesPatch(absolutePath, absolutePath, oldContent, content);

    toolLogger.debug("Requesting write permission", {
      path: workspace.getRelativePath(absolutePath),
      created: !exists,
    });

    // Check edit permission
    const editApproved = await permissionMgr.requestApproval({
      id: nanoid(),
      permission: "edit",
      patterns: [workspace.getRelativePath(absolutePath)],
      always: [],
      sessionID,
      metadata: { diff, filepath: absolutePath },
    });

    if (!editApproved) {
      toolLogger.warn("Write permission denied", {
        path: workspace.getRelativePath(absolutePath),
      });
      throw new Error(`Permission denied: Cannot write to ${filePath}`);
    }

    // Create parent directories
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });

    // Write file
    await fs.writeFile(absolutePath, content, "utf-8");

    toolLogger.info("File written successfully", {
      path: workspace.getRelativePath(absolutePath),
      created: !exists,
      size: content.length,
    });

    return {
      success: true,
      filePath: workspace.getRelativePath(absolutePath),
      diff,
      created: !exists,
    };
  },
});
