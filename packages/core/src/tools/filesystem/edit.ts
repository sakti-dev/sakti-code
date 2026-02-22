/**
 * Edit file tool
 */

import { createLogger } from "@sakti-code/shared/logger";
import { tool, zodSchema } from "ai";
import fs from "node:fs/promises";
import { z } from "zod";
import { LSP } from "../../lsp";
import { PermissionManager } from "../../security/permission-manager";
import { getContextOrThrow } from "../base/context";
import { validatePathOperation } from "../base/safety";

const logger = createLogger("sakti-code");

export const editTool = tool({
  description: `Edit a file by replacing text.

- Replaces occurrences of oldString with newString
- For replaceAll=false, replaces only the first occurrence
- For replaceAll=true, replaces all occurrences
- Use exact text matching from the source file
- For multiple edits, use the multiedit tool`,

  inputSchema: zodSchema(
    z.object({
      filePath: z.string().describe("Absolute path to the file"),
      oldString: z.string().describe("Exact text to replace"),
      newString: z.string().describe("Replacement text"),
      replaceAll: z.boolean().optional().describe("Replace all occurrences (default: false)"),
    })
  ),

  outputSchema: zodSchema(
    z.object({
      success: z.boolean(),
      filePath: z.string(),
      replacements: z.number(),
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

  execute: async ({ filePath, oldString, newString, replaceAll = false }, _options) => {
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
      logger.warn("String not found in file", {
        module: "tool:edit",
        tool: "edit",
        sessionID,
        path: relativePath,
        search: oldString.slice(0, 50),
      });
      throw new Error(`String not found in file: "${oldString.slice(0, 50)}..."`);
    }

    await fs.writeFile(absolutePath, content, "utf-8");

    logger.info("File edited successfully", {
      module: "tool:edit",
      tool: "edit",
      sessionID,
      path: relativePath,
      replacements,
      replaceAll,
    });

    await LSP.touchFile(absolutePath, true);
    const diagnostics = LSP.getDiagnostics();

    return {
      success: true,
      filePath: relativePath,
      replacements,
      diagnostics,
    };
  },
});
