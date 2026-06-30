import nodePath from "node:path";
import { readdir } from "node:fs/promises";
import type { AgentTool, AgentToolUpdateCallback } from "@sakti-code/agent";
import { type Static, Type } from "typebox";
import { pathExists, resolveToCwd } from "../lib/path-utils.ts";
import { runProcess } from "../lib/spawn.ts";
import { EXCLUDE_GLOBS } from "../lib/excludes.ts";
import { buildPathNotFoundMessage } from "../lib/path-errors.ts";
import {
  DEFAULT_MAX_BYTES,
  formatSize,
  GREP_MAX_LINE_LENGTH,
  type TruncationResult,
  truncateHead,
  truncateLine,
} from "../lib/truncate.ts";

const grepSchema = Type.Object({
  pattern: Type.String({ description: "Search pattern (regex by default)" }),
  path: Type.Optional(
    Type.String({ description: "Directory or file to search (default: current directory)" }),
  ),
  glob: Type.Optional(
    Type.String({ description: "Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'" }),
  ),
  literal: Type.Optional(
    Type.Boolean({
      description: "Treat pattern as a literal string instead of regex (default: false)",
    }),
  ),
  context: Type.Optional(
    Type.Number({
      description: "Number of lines to show before and after each match (default: 0)",
    }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Maximum number of matches to return (default: 100)" }),
  ),
});

export type GrepToolInput = Static<typeof grepSchema>;
const DEFAULT_LIMIT = 100;

export interface GrepToolDetails {
  linesTruncated?: boolean;
  matchLimitReached?: number;
  truncation?: TruncationResult;
}

export interface GrepToolOptions {
  rgPath?: string;
}

interface RgRecord {
  type: string;
  data?: {
    path?: { text?: string };
    line_number?: number;
    lines?: { text?: string };
  };
}

/**
 * Parse a `rg --json` stdout stream into the standard `path:line: text`
 * (match) / `path-line- text` (context) text format, in a single pass.
 * Context comes from rg's own records — NO separate file read (the previous
 * read was the source of garbled/misaligned context via CRLF/desync/race).
 * Tool-side truncation is mandatory: `--max-columns` is ignored under `--json`.
 */
export function formatRgJsonStream(
  stdout: string,
  projectRoot: string,
  options: { matchLimit?: number; maxLineChars?: number } = {},
): { output: string; matchCount: number; linesTruncated: boolean; limitReached: boolean } {
  const matchLimit = options.matchLimit ?? DEFAULT_LIMIT;
  const maxLineChars = options.maxLineChars ?? GREP_MAX_LINE_LENGTH;
  const out: string[] = [];
  let matchCount = 0;
  let linesTruncated = false;

  for (const line of stdout.split("\n")) {
    if (!line) continue;
    let event: RgRecord;
    try {
      event = JSON.parse(line) as RgRecord;
    } catch {
      continue;
    }
    if (event.type !== "match" && event.type !== "context") continue;

    if (event.type === "match") {
      matchCount++;
      if (matchCount > matchLimit) break;
    }

    const data = event.data ?? {};
    const rawPath = data.path?.text ?? "";
    const relativePath = relativize(rawPath, projectRoot);
    const lineNumber = data.line_number;
    if (relativePath === "" || typeof lineNumber !== "number") continue;

    let text = (data.lines?.text ?? "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "")
      .replace(/\n$/, "");
    const truncated = truncateLine(text, maxLineChars);
    if (truncated.wasTruncated) {
      text = truncated.text;
      linesTruncated = true;
    }
    const sep = event.type === "match" ? ":" : "-";
    out.push(`${relativePath}${sep}${lineNumber}${sep} ${text}`);
  }

  const limitReached = matchCount > matchLimit;
  return {
    output: out.join("\n"),
    matchCount: Math.min(matchCount, matchLimit),
    linesTruncated,
    limitReached,
  };
}

function relativize(rawPath: string, projectRoot: string): string {
  // rg emits absolute paths when invoked with an absolute search path.
  let rel = rawPath;
  if (nodePath.isAbsolute(rel)) {
    rel = nodePath.relative(projectRoot, rel);
  }
  // When the search target is a single file, projectRoot == rawPath and
  // relative() returns "" — fall back to the basename so records survive.
  if (rel === "") {
    rel = nodePath.basename(rawPath);
  }
  return rel.replace(/\\/g, "/");
}

export function createGrepTool(
  cwd: string,
  options?: GrepToolOptions,
): AgentTool<typeof grepSchema, GrepToolDetails | undefined> {
  return {
    name: "grep",
    label: "grep",
    description: `Search file contents for a pattern. Returns matching lines with file paths and line numbers. Searches all files including gitignored ones, excluding .git and node_modules. Output is truncated to ${DEFAULT_LIMIT} matches or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Long lines are truncated to ${GREP_MAX_LINE_LENGTH} chars. Smart-case is on: case-insensitive for all-lowercase patterns, sensitive otherwise.`,
    parameters: grepSchema,
    permissions: (params) => [
      { permission: "grep", patterns: [(params as GrepToolInput).pattern] },
    ],
    async execute(
      _toolCallId: string,
      { pattern, path: searchDir, glob, literal, context, limit }: GrepToolInput,
      signal?: AbortSignal,
      _onUpdate?: AgentToolUpdateCallback<GrepToolDetails | undefined>,
    ) {
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }

      const rgPath = options?.rgPath ?? "rg";
      const searchPath = resolveToCwd(searchDir || ".", cwd);
      const contextValue = context && context > 0 ? context : 0;
      const effectiveLimit = Math.max(1, limit ?? DEFAULT_LIMIT);

      // Pre-flight: reject a missing search path with a friendly message
      // enriched from the parent dir, before rg can leak an IO error.
      if (!(await pathExists(searchPath))) {
        let parentEntries: string[] | null = null;
        const parent = nodePath.dirname(searchPath);
        if (await pathExists(parent)) {
          try {
            parentEntries = await readdir(parent);
          } catch {
            parentEntries = null;
          }
        }
        throw new Error(buildPathNotFoundMessage(searchPath, parentEntries));
      }

      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }

      const args: string[] = ["--no-config", "--json", "--smart-case", "--hidden", "--no-ignore"];
      if (glob) {
        // Include glob FIRST: rg multi-glob is last-match-wins, so a later
        // include would override the exclude globs below and re-include
        // build artifacts that match the glob.
        args.push("--glob", glob);
      }
      args.push(...EXCLUDE_GLOBS.map((g) => `--glob=!${g}`));
      if (literal) {
        args.push("--fixed-strings");
      }
      if (contextValue > 0) {
        args.push(`--context=${contextValue}`);
      }
      if (glob) {
        args.push("--glob", glob);
      }
      args.push("--", pattern, searchPath);

      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }

      const { exitCode, stderr, stdout } = await runProcess(rgPath, args, signal ? { signal } : {});
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }
      if (exitCode !== 0 && exitCode !== 1) {
        throw new Error(stderr.trim() || `ripgrep exited with code ${exitCode}`);
      }

      const { output, linesTruncated, limitReached } = formatRgJsonStream(stdout, searchPath, {
        matchLimit: effectiveLimit,
      });

      if (output.length === 0) {
        return { content: [{ type: "text", text: "No matches found" }], details: undefined };
      }

      const truncation = truncateHead(output, { maxLines: Number.MAX_SAFE_INTEGER });
      let resultOutput = truncation.content;
      const details: GrepToolDetails = {};
      const notices: string[] = [];
      if (limitReached) {
        notices.push(
          `${effectiveLimit} matches limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`,
        );
        details.matchLimitReached = effectiveLimit;
      }
      if (truncation.truncated) {
        notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
        details.truncation = truncation;
      }
      if (linesTruncated) {
        notices.push(
          `Some lines truncated to ${GREP_MAX_LINE_LENGTH} chars. Use read tool to see full lines`,
        );
        details.linesTruncated = true;
      }
      if (notices.length > 0) {
        resultOutput += `\n\n[${notices.join(". ")}]`;
      }
      return {
        content: [{ type: "text", text: resultOutput }],
        details: Object.keys(details).length > 0 ? details : undefined,
      };
    },
  };
}
