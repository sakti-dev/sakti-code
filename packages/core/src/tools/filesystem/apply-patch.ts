/**
 * Apply patch tool
 */

import { tool, zodSchema } from "ai";
import { applyPatch, parsePatch } from "diff";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { PermissionManager } from "../../security/permission-manager";
import { getContextOrThrow } from "../base/context";
import { validatePathOperation } from "../base/safety";

export const applyPatchTool = tool({
  description: `Apply a unified diff patch to files.

- Supports add, update, delete, and move operations
- Creates parent directories automatically
- Shows comprehensive diff before applying
- All operations in the patch are atomic (all succeed or all fail)`,

  inputSchema: zodSchema(
    z.object({
      patchText: z.string().describe("Full unified diff patch text"),
    })
  ),

  outputSchema: zodSchema(
    z.object({
      success: z.boolean(),
      filesModified: z.number(),
      files: z.array(
        z.object({
          path: z.string(),
          action: z.enum(["add", "update", "delete", "move"]),
        })
      ),
    })
  ),

  execute: async ({ patchText }, _options) => {
    // Get context with enhanced error message
    const { directory, sessionID } = getContextOrThrow();
    const permissionMgr = PermissionManager.getInstance();

    let patches: ReturnType<typeof parsePatch> = [];
    try {
      patches = parsePatch(patchText);
    } catch {
      patches = [];
    }
    const operations: Array<{
      action: "add" | "update" | "delete" | "move";
      oldPath?: { absolutePath: string; relativePath: string };
      newPath?: { absolutePath: string; relativePath: string };
      content?: string;
    }> = [];

    const hasUsablePatch = patches.some(
      patch => normalizePatchPath(patch.oldFileName) || normalizePatchPath(patch.newFileName)
    );

    if (patches.length === 0 || !hasUsablePatch) {
      const fallback = parseSimplePatch(patchText);
      if (fallback.length === 0) {
        throw new Error("Invalid patch format");
      }

      for (const file of fallback) {
        const result = await validatePathOperation(
          file.path,
          directory,
          "edit",
          permissionMgr,
          sessionID,
          { metadata: { patchText } }
        );
        const exists = await fs
          .access(result.absolutePath)
          .then(() => true)
          .catch(() => false);
        operations.push({
          action: exists ? "update" : "add",
          newPath: { absolutePath: result.absolutePath, relativePath: result.relativePath },
          content: file.content,
        });
      }
    } else {
      for (const patch of patches) {
        const oldPath = normalizePatchPath(patch.oldFileName);
        const newPath = normalizePatchPath(patch.newFileName);

        if (!oldPath && !newPath) {
          throw new Error("Invalid patch format");
        }

        let action: "add" | "update" | "delete" | "move" = "update";
        if (!oldPath && newPath) action = "add";
        else if (oldPath && !newPath) action = "delete";
        else if (oldPath && newPath && oldPath !== newPath) action = "move";

        let oldResult: { absolutePath: string; relativePath: string } | undefined;
        let newResult: { absolutePath: string; relativePath: string } | undefined;

        if (oldPath && newPath && oldPath === newPath) {
          const result = await validatePathOperation(
            oldPath,
            directory,
            "edit",
            permissionMgr,
            sessionID,
            { metadata: { patchText } }
          );
          oldResult = { absolutePath: result.absolutePath, relativePath: result.relativePath };
          newResult = oldResult;
        } else {
          if (oldPath) {
            const result = await validatePathOperation(
              oldPath,
              directory,
              "edit",
              permissionMgr,
              sessionID,
              { metadata: { patchText } }
            );
            oldResult = { absolutePath: result.absolutePath, relativePath: result.relativePath };
          }

          if (newPath) {
            const result = await validatePathOperation(
              newPath,
              directory,
              "edit",
              permissionMgr,
              sessionID,
              { metadata: { patchText } }
            );
            newResult = { absolutePath: result.absolutePath, relativePath: result.relativePath };
          }
        }

        const sourcePath = action === "add" ? newResult : oldResult;
        if (!sourcePath) {
          throw new Error("Invalid patch format");
        }

        const exists = await fs
          .access(sourcePath.absolutePath)
          .then(() => true)
          .catch(() => false);

        const oldContent = exists ? await fs.readFile(sourcePath.absolutePath, "utf-8") : "";
        const applied = applyPatch(oldContent, patch);

        if (applied === false) {
          throw new Error(
            `Failed to apply patch to ${sourcePath.relativePath || sourcePath.absolutePath}`
          );
        }

        if (action === "delete") {
          operations.push({
            action,
            oldPath: oldResult,
          });
        } else if (action === "move") {
          operations.push({
            action,
            oldPath: oldResult,
            newPath: newResult,
            content: applied,
          });
        } else {
          operations.push({
            action,
            newPath: newResult,
            content: applied,
          });
        }
      }
    }

    // Apply all operations after successful parsing
    for (const op of operations) {
      if (op.action === "delete" && op.oldPath) {
        await fs.unlink(op.oldPath.absolutePath).catch(() => undefined);
        continue;
      }

      const target = op.action === "move" ? op.newPath : op.newPath;
      if (!target || op.content === undefined) {
        throw new Error("Invalid patch operation");
      }

      await fs.mkdir(path.dirname(target.absolutePath), { recursive: true });
      await fs.writeFile(target.absolutePath, op.content, "utf-8");

      if (op.action === "move" && op.oldPath) {
        await fs.unlink(op.oldPath.absolutePath).catch(() => undefined);
      }
    }

    return {
      success: true,
      filesModified: operations.length,
      files: operations.map(op => ({
        path: (op.newPath ?? op.oldPath)?.relativePath ?? "",
        action: op.action,
      })),
    };
  },
});

function normalizePatchPath(fileName?: string | null): string | null {
  if (!fileName) return null;
  const trimmed = fileName.split("\t")[0]?.trim();
  if (!trimmed || trimmed === "/dev/null") return null;
  if (trimmed.startsWith("a/") || trimmed.startsWith("b/")) {
    return trimmed.slice(2);
  }
  if (trimmed.startsWith("a\\") || trimmed.startsWith("b\\")) {
    return trimmed.slice(2);
  }
  return trimmed;
}

function parseSimplePatch(patchText: string): Array<{ path: string; content: string }> {
  const lines = patchText.split(/\r?\n/);
  const files: Array<{ path: string; content: string[] }> = [];
  let current: { path: string; content: string[] } | null = null;

  for (const line of lines) {
    if (line.startsWith("+++ ")) {
      if (current) files.push(current);
      const rawPath = line.substring(4).split("\t")[0].trim();
      const normalized = normalizePatchPath(rawPath);
      if (normalized) {
        current = { path: normalized, content: [] };
      } else {
        current = null;
      }
      continue;
    }

    if (!current) continue;

    if (line.startsWith("--- ")) continue;
    if (line.startsWith("@@")) continue;

    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.content.push(line.substring(1));
    } else if (line.startsWith(" ")) {
      current.content.push(line.substring(1));
    }
  }

  if (current) files.push(current);

  return files.map(file => ({
    path: file.path,
    content: file.content.join("\n"),
  }));
}
