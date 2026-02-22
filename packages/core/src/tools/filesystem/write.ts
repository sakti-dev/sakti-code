/**
 * Write file tool
 */

import { createLogger } from "@sakti-code/shared/logger";
import { tool, zodSchema } from "ai";
import { createTwoFilesPatch } from "diff";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { LSP } from "../../lsp";
import { PermissionManager } from "../../security/permission-manager";
import { getContextOrThrow } from "../base/context";
import { validatePathOperation } from "../base/safety";

const logger = createLogger("sakti-code");

export const writeTool = tool({
  description: `Write content to a file.

- Creates parent directories automatically
- Shows unified diff before writing
- Requires permission for file modifications
- Overwrites existing files if they exist`,

  inputSchema: zodSchema(
    z.object({
      content: z.string().describe("Content to write to the file"),
      filePath: z.string().describe("Absolute path to the file"),
    })
  ),

  outputSchema: zodSchema(
    z.object({
      success: z.boolean(),
      filePath: z.string(),
      diff: z.string(),
      created: z.boolean(),
      diagnostics: z
        .record(
          z.string(),
          z.array(
            z.object({
              severity: z.number(),
              message: z.string(),
              range: z.object({
                start: z.object({ line: z.number(), character: z.number() }),
                end: z.object({ line: z.number(), character: z.number() }),
              }),
              source: z.string().optional(),
            })
          )
        )
        .optional(),
    })
  ),

  execute: async ({ content, filePath }, _options) => {
    // Get context with enhanced error message
    const { directory, sessionID } = getContextOrThrow();
    const permissionMgr = PermissionManager.getInstance();

    // Validate path operation and get safe paths
    const { absolutePath, relativePath } = await validatePathOperation(
      filePath,
      directory,
      "edit",
      permissionMgr,
      sessionID
    );

    // Check if file exists
    const exists = await fs
      .access(absolutePath)
      .then(() => true)
      .catch(() => false);
    const oldContent = exists ? await fs.readFile(absolutePath, "utf-8") : "";

    // Generate diff
    const diff = createTwoFilesPatch(absolutePath, absolutePath, oldContent, content);

    // Create parent directories
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });

    // Write file
    await fs.writeFile(absolutePath, content, "utf-8");

    logger.info("File written successfully", {
      module: "tool:write",
      tool: "write",
      sessionID,
      path: relativePath,
      created: !exists,
      size: content.length,
    });

    await LSP.touchFile(absolutePath, true);
    const diagnostics = LSP.getDiagnostics();

    return {
      success: true,
      filePath: relativePath,
      diff,
      created: !exists,
      diagnostics,
    };
  },
});
