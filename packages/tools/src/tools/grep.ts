import { stat as fsStat } from "node:fs/promises";
import nodePath from "node:path";
import type { AgentTool, AgentToolUpdateCallback } from "@sakti-code/agent";
import { type Static, Type } from "typebox";
import { resolveToCwd } from "../lib/path-utils.ts";
import {
  DEFAULT_MAX_BYTES,
  formatSize,
  GREP_MAX_LINE_LENGTH,
  type TruncationResult,
  truncateHead,
  truncateLine,
} from "../lib/truncate.ts";

const grepSchema = Type.Object({
  pattern: Type.String({
    description: "Search pattern (regex or literal string)",
  }),
  path: Type.Optional(
    Type.String({
      description: "Directory or file to search (default: current directory)",
    })
  ),
  glob: Type.Optional(
    Type.String({
      description:
        "Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'",
    })
  ),
  ignoreCase: Type.Optional(
    Type.Boolean({ description: "Case-insensitive search (default: false)" })
  ),
  literal: Type.Optional(
    Type.Boolean({
      description:
        "Treat pattern as literal string instead of regex (default: false)",
    })
  ),
  context: Type.Optional(
    Type.Number({
      description:
        "Number of lines to show before and after each match (default: 0)",
    })
  ),
  limit: Type.Optional(
    Type.Number({
      description: "Maximum number of matches to return (default: 100)",
    })
  ),
});

export type GrepToolInput = Static<typeof grepSchema>;
const DEFAULT_LIMIT = 100;

export interface GrepToolDetails {
  linesTruncated?: boolean;
  matchLimitReached?: number;
  truncation?: TruncationResult;
}

export interface GrepOperations {
  isDirectory: (absolutePath: string) => Promise<boolean> | boolean;
  readFile: (absolutePath: string) => Promise<string> | string;
}

const defaultGrepOperations: GrepOperations = {
  isDirectory: async (p) => (await fsStat(p)).isDirectory(),
  readFile: (p) => Bun.file(p).text(),
};

export interface GrepToolOptions {
  operations?: GrepOperations;
  rgPath?: string;
}

export function createGrepTool(
  cwd: string,
  options?: GrepToolOptions
): AgentTool<typeof grepSchema, GrepToolDetails | undefined> {
  const customOps = options?.operations;
  return {
    name: "grep",
    label: "grep",
    description: `Search file contents for a pattern. Returns matching lines with file paths and line numbers. Respects .gitignore. Output is truncated to ${DEFAULT_LIMIT} matches or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Long lines are truncated to ${GREP_MAX_LINE_LENGTH} chars.`,
    parameters: grepSchema,
    async execute(
      _toolCallId: string,
      {
        pattern,
        path: searchDir,
        glob,
        ignoreCase,
        literal,
        context,
        limit,
      }: GrepToolInput,
      signal?: AbortSignal,
      _onUpdate?: AgentToolUpdateCallback<GrepToolDetails | undefined>
    ) {
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }

      const rgPath = options?.rgPath ?? "rg";
      const searchPath = resolveToCwd(searchDir || ".", cwd);
      const ops = customOps ?? defaultGrepOperations;
      let isDirectory: boolean;
      try {
        isDirectory = await ops.isDirectory(searchPath);
      } catch {
        throw new Error(`Path not found: ${searchPath}`);
      }

      const contextValue = context && context > 0 ? context : 0;
      const effectiveLimit = Math.max(1, limit ?? DEFAULT_LIMIT);
      const formatPath = (filePath: string): string => {
        if (isDirectory) {
          const relative = nodePath.relative(searchPath, filePath);
          if (relative && !relative.startsWith("..")) {
            return relative.replace(/\\/g, "/");
          }
        }
        return nodePath.basename(filePath);
      };

      const fileCache = new Map<string, string[]>();
      const getFileLines = async (filePath: string): Promise<string[]> => {
        let lines = fileCache.get(filePath);
        if (!lines) {
          try {
            const content = await ops.readFile(filePath);
            lines = content
              .replace(/\r\n/g, "\n")
              .replace(/\r/g, "")
              .split("\n");
          } catch {
            lines = [];
          }
          fileCache.set(filePath, lines);
        }
        return lines;
      };

      const args: string[] = [
        "--json",
        "--line-number",
        "--color=never",
        "--hidden",
      ];
      if (ignoreCase) {
        args.push("--ignore-case");
      }
      if (literal) {
        args.push("--fixed-strings");
      }
      if (glob) {
        args.push("--glob", glob);
      }
      args.push("--", pattern, searchPath);

      const proc = Bun.spawn({
        cmd: [rgPath, ...args],
        stdout: "pipe",
        stderr: "pipe",
      });

      const onAbort = () => proc.kill();
      signal?.addEventListener("abort", onAbort, { once: true });

      try {
        const [stdoutText, stderrText, exitCode] = await Promise.all([
          new Response(proc.stdout as ReadableStream).text(),
          new Response(proc.stderr as ReadableStream).text(),
          proc.exited,
        ]);

        if (signal?.aborted) {
          throw new Error("Operation aborted");
        }
        if (exitCode !== 0 && exitCode !== 1) {
          throw new Error(
            stderrText.trim() || `ripgrep exited with code ${exitCode}`
          );
        }

        const lines = stdoutText.split("\n").filter(Boolean);
        const matches: Array<{
          filePath: string;
          lineNumber: number;
          lineText?: string;
        }> = [];
        let matchLimitReached = false;
        let matchCount = 0;

        const formatBlock = async (
          filePath: string,
          lineNumber: number
        ): Promise<string[]> => {
          const relativePath = formatPath(filePath);
          const fileLines = await getFileLines(filePath);
          if (!fileLines.length) {
            return [`${relativePath}:${lineNumber}: (unable to read file)`];
          }
          const block: string[] = [];
          const start =
            contextValue > 0
              ? Math.max(1, lineNumber - contextValue)
              : lineNumber;
          const end =
            contextValue > 0
              ? Math.min(fileLines.length, lineNumber + contextValue)
              : lineNumber;
          for (let current = start; current <= end; current++) {
            const lineText = fileLines[current - 1] ?? "";
            const sanitized = lineText.replace(/\r/g, "");
            const isMatchLine = current === lineNumber;
            const { text: truncatedText, wasTruncated } =
              truncateLine(sanitized);
            if (wasTruncated) {
              linesTruncated = true;
            }
            if (isMatchLine) {
              block.push(`${relativePath}:${current}: ${truncatedText}`);
            } else {
              block.push(`${relativePath}-${current}- ${truncatedText}`);
            }
          }
          return block;
        };

        let linesTruncated = false;

        for (const line of lines) {
          if (matchCount >= effectiveLimit) {
            matchLimitReached = true;
            break;
          }
          let event: Record<string, unknown>;
          try {
            event = JSON.parse(line) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (event.type === "match") {
            matchCount++;
            const filePath = (event.data as Record<string, unknown>)?.path
              ? (
                  (event.data as Record<string, unknown>)?.path as {
                    text?: string;
                  }
                )?.text
              : undefined;
            const lineNumber = (event.data as Record<string, unknown>)
              ?.line_number as number | undefined;
            const lineText = (event.data as Record<string, unknown>)?.lines
              ? (
                  (event.data as Record<string, unknown>)?.lines as {
                    text?: string;
                  }
                )?.text
              : undefined;
            if (filePath && typeof lineNumber === "number") {
              matches.push({
                filePath,
                lineNumber,
                ...(lineText === undefined ? {} : { lineText }),
              });
            }
          }
        }

        if (matches.length === 0) {
          return {
            content: [{ type: "text", text: "No matches found" }],
            details: undefined,
          };
        }

        const outputLines: string[] = [];

        for (const match of matches) {
          if (contextValue === 0 && match.lineText !== undefined) {
            const relativePath = formatPath(match.filePath);
            const sanitized = match.lineText
              .replace(/\r\n/g, "\n")
              .replace(/\r/g, "")
              .replace(/\n$/, "");
            const { text: truncatedText, wasTruncated } =
              truncateLine(sanitized);
            if (wasTruncated) {
              linesTruncated = true;
            }
            outputLines.push(
              `${relativePath}:${match.lineNumber}: ${truncatedText}`
            );
          } else {
            const block = await formatBlock(match.filePath, match.lineNumber);
            outputLines.push(...block);
          }
        }

        const rawOutput = outputLines.join("\n");
        const truncation = truncateHead(rawOutput, {
          maxLines: Number.MAX_SAFE_INTEGER,
        });
        let output = truncation.content;
        const details: GrepToolDetails = {};
        const notices: string[] = [];
        if (matchLimitReached) {
          notices.push(
            `${effectiveLimit} matches limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`
          );
          details.matchLimitReached = effectiveLimit;
        }
        if (truncation.truncated) {
          notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
          details.truncation = truncation;
        }
        if (linesTruncated) {
          notices.push(
            `Some lines truncated to ${GREP_MAX_LINE_LENGTH} chars. Use read tool to see full lines`
          );
          details.linesTruncated = true;
        }
        if (notices.length > 0) {
          output += `\n\n[${notices.join(". ")}]`;
        }
        return {
          content: [{ type: "text", text: output }],
          details: Object.keys(details).length > 0 ? details : undefined,
        };
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}
