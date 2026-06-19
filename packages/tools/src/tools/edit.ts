import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { validateArgs } from "../lib/shared.ts";
import type { ToolDefinition } from "../lib/types.ts";

function stripBom(content: string): { bom: string; text: string } {
  if (content.charCodeAt(0) === 0xfe_ff) {
    return { bom: "\ufeff", text: content.slice(1) };
  }
  return { bom: "", text: content };
}

function detectLineEnding(content: string): string {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

function normalizeToLf(content: string): string {
  return content.replace(/\r\n/g, "\n");
}

function restoreLineEndings(content: string, ending: string): string {
  if (ending === "\r\n") {
    return content.replace(/\n/g, "\r\n");
  }
  return content;
}

const fileLocks = new Map<string, Promise<void>>();

function withFileLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const pending = fileLocks.get(path);
  const next = pending ? pending.then(fn, fn) : fn();
  fileLocks.set(
    path,
    next.then(
      () => {
        if (fileLocks.get(path) === next) {
          fileLocks.delete(path);
        }
      },
      () => {
        if (fileLocks.get(path) === next) {
          fileLocks.delete(path);
        }
      }
    )
  );
  return next;
}

export function createEditTool(cwd: string): ToolDefinition {
  return {
    name: "edit",
    description:
      "Apply exact text replacements to a file. Every edits[].oldText must match a unique, non-overlapping region. BOM and line endings are preserved.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to cwd" },
        edits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              oldText: { type: "string" },
              newText: { type: "string" },
            },
            required: ["oldText", "newText"],
          },
        },
      },
      required: ["path", "edits"],
    },
    execute: async (_id, args) => {
      const v = validateArgs(
        args as Record<string, unknown>,
        {
          path: { type: "string", required: true },
          edits: { type: "array", required: true },
        },
        "edit"
      );
      if (!v.valid) {
        return { content: v.error, terminate: false, isError: true };
      }
      const { path, edits } = v.args as {
        path: string;
        edits: Array<{ oldText: string; newText: string }>;
      };
      const filePath = resolve(cwd, path);

      if (!existsSync(filePath)) {
        return {
          content: `File not found: ${path}`,
          terminate: false,
          isError: true,
        };
      }
      if (!Array.isArray(edits) || edits.length === 0) {
        return {
          content: "edits must be a non-empty array",
          terminate: false,
          isError: true,
        };
      }

      return await withFileLock(filePath, async () => {
        const raw = await readFile(filePath, "utf-8");
        const { bom, text } = stripBom(raw);
        const originalEnding = detectLineEnding(text);
        const normalized = normalizeToLf(text);

        for (const edit of edits) {
          const count = normalized.split(edit.oldText).length - 1;
          if (count === 0) {
            return {
              content: `Edit failed: oldText not found in ${path}:\n${edit.oldText.slice(0, 200)}`,
              terminate: false,
              isError: true,
            };
          }
          if (count > 1) {
            return {
              content: `Edit failed: oldText matches ${count} locations in ${path} (must be unique). Add more context:\n${edit.oldText.slice(0, 200)}`,
              terminate: false,
              isError: true,
            };
          }
        }

        let result = normalized;
        for (const edit of edits) {
          result = result.replace(edit.oldText, edit.newText);
        }

        const final = bom + restoreLineEndings(result, originalEnding);
        await writeFile(filePath, final, "utf-8");
        return {
          content: `Applied ${edits.length} edit(s) to ${path}`,
          terminate: false,
        };
      });
    },
  };
}
