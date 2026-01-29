/**
 * Read file tool
 */

import { createLogger } from "@ekacode/shared/logger";
import { tool, zodSchema } from "ai";
import fs from "node:fs/promises";
import path from "node:path";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { PermissionManager } from "../../security/permission-manager";
import { WorkspaceInstance } from "../../workspace/instance";
import { assertExternalDirectory, detectBinaryFile } from "../base/filesystem";
import { truncateOutput } from "../base/truncation";

const logger = createLogger("ekacode");

export const readTool = tool({
  description: `Read a file from the local filesystem.

- The filePath should be an absolute path (or relative to workspace root)
- Large files are truncated to 2000 lines / 50KB
- Binary files are detected and rejected with an error
- Output uses cat -n format with line numbers`,

  inputSchema: zodSchema(
    z.object({
      filePath: z.string().describe("Path to the file to read"),
      offset: z.coerce.number().min(0).optional().describe("Line offset to start reading"),
      limit: z.coerce.number().min(1).optional().describe("Maximum number of lines to read"),
    })
  ),

  outputSchema: zodSchema(
    z.object({
      content: z.string(),
      metadata: z.object({
        truncated: z.boolean(),
        lineCount: z.number(),
        filePath: z.string(),
        preview: z.boolean().optional(),
      }),
    })
  ),

  execute: async ({ filePath, offset = 0, limit }, options) => {
    const workspace = WorkspaceInstance.getInstance();
    const permissionMgr = PermissionManager.getInstance();
    const sessionID =
      (options.experimental_context as { sessionID?: string })?.sessionID || uuidv7();
    const toolLogger = logger.child({ module: "tool:read", tool: "read", sessionID });

    // Resolve path
    let absolutePath = filePath;
    if (!path.isAbsolute(filePath)) {
      absolutePath = path.join(workspace.root, filePath);
    }

    toolLogger.debug("Reading file", {
      path: workspace.getRelativePath(absolutePath),
      offset,
      limit,
    });

    // Check external directory permission
    await assertExternalDirectory(absolutePath, workspace.root, async (permission, patterns) => {
      return permissionMgr.requestApproval({
        id: uuidv7(),
        permission,
        patterns,
        always: [],
        sessionID,
      });
    });

    // Check read permission
    const readApproved = await permissionMgr.requestApproval({
      id: uuidv7(),
      permission: "read",
      patterns: [absolutePath],
      always: ["*"],
      sessionID,
    });

    if (!readApproved) {
      toolLogger.warn("Read permission denied", {
        path: workspace.getRelativePath(absolutePath),
      });
      throw new Error(`Permission denied: Cannot read ${filePath}`);
    }

    // Read file
    const buffer = await fs.readFile(absolutePath);

    // Check for binary
    const isBinary = await detectBinaryFile(absolutePath, buffer);
    if (isBinary) {
      toolLogger.warn("Binary file detected", {
        path: workspace.getRelativePath(absolutePath),
      });
      throw new Error(`Cannot read binary file: ${filePath}`);
    }

    let content = buffer.toString("utf-8");

    // Apply offset/limit
    const lines = content.split("\n");
    const totalLines = lines.length;

    if (offset > 0 || limit) {
      const startIdx = Math.max(0, offset);
      const endIdx = limit ? Math.min(startIdx + limit, lines.length) : lines.length;
      content = lines.slice(startIdx, endIdx).join("\n");
    }

    // Truncate if needed
    const { content: finalContent, truncated } = await truncateOutput(content);

    // Format with line numbers
    const startLine = offset + 1;
    const numberedContent = finalContent
      .split("\n")
      .map((line, i) => `${String(startLine + i).padStart(6)}→${line}`)
      .join("\n");

    toolLogger.info("File read successfully", {
      path: workspace.getRelativePath(absolutePath),
      lineCount: totalLines,
      truncated,
    });

    return {
      content: numberedContent,
      metadata: {
        truncated,
        lineCount: totalLines,
        filePath: workspace.getRelativePath(absolutePath),
        preview: totalLines < 50,
      },
    };
  },
});
