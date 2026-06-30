import nodePath, { basename, dirname } from "node:path";
import { readdir } from "node:fs/promises";
import type { AgentTool, AgentToolUpdateCallback } from "@sakti-code/agent";
import { type Static, Type } from "typebox";
import { pathExists, resolveToCwd } from "../lib/path-utils.ts";
import { runProcess } from "../lib/spawn.ts";
import {
  DEFAULT_MAX_BYTES,
  formatSize,
  type TruncationResult,
  truncateHead,
} from "../lib/truncate.ts";

function toPosixPath(value: string): string {
  return value.split(nodePath.sep).join("/");
}

const findSchema = Type.Object({
  pattern: Type.String({
    description:
      "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'. A bare name fragment like 'Button' is also accepted and matched as a substring across the whole path.",
  }),
  path: Type.Optional(
    Type.String({ description: "Directory to search in (default: current directory)" }),
  ),
  limit: Type.Optional(Type.Number({ description: "Maximum number of results (default: 1000)" })),
});

export type FindToolInput = Static<typeof findSchema>;
const DEFAULT_LIMIT = 1000;

export interface FindToolDetails {
  resultLimitReached?: number;
  truncation?: TruncationResult;
}

export interface FindOperations {
  exists: (absolutePath: string) => Promise<boolean> | boolean;
  glob: (
    pattern: string,
    cwd: string,
    options: { ignore: string[]; limit: number },
  ) => Promise<string[]> | string[];
}

const defaultFindOperations: FindOperations = {
  exists: pathExists,
  glob: () => [],
};

export interface FindToolOptions {
  rgPath?: string;
  operations?: FindOperations;
}

/** True if the pattern has glob metacharacters; otherwise it's a name fragment. */
const GLOB_CHARS = /[*?[\]{}]/;

/** Dispatch: real globs pass through; bare fragments become substring globs. */
export function resolveGlobPattern(inputPattern: string): string {
  if (GLOB_CHARS.test(inputPattern)) {
    return inputPattern;
  }
  return `**/*${inputPattern}*`;
}

/**
 * Directories never useful in file-search results (VCS, deps, build output).
 * Single source of truth — consumed by both the DI and production branches.
 * NOTE: rg multi-glob is last-match-wins, so the include glob MUST be passed
 * BEFORE these negation globs, or matching files inside these dirs get
 * re-included.
 */
const EXCLUDE_GLOBS = [
  "**/.git/**",
  "**/node_modules/**",
  "**/target/**", // Rust
  "**/dist/**", // generic build output / TS
  "**/build/**", // generic
  "**/.next/**", // Next.js
  "**/out/**", // Next.js export / generic
];

const LISTING_CAP = 20;
const SIMILAR_CAP = 5;

export type RgOutcome =
  | { kind: "results" }
  | { kind: "empty" }
  | { kind: "error"; message: string };

/**
 * Classify a `rg --files` result by its exit code.
 * rg contract: 0 = matches, 1 = no matches (success), >=2 = error.
 * Pure — no I/O.
 */
export function classifyRgExitCode(exitCode: number, _stdout: string, stderr: string): RgOutcome {
  if (exitCode === 0) return { kind: "results" };
  if (exitCode === 1) return { kind: "empty" };
  return { kind: "error", message: stderr.trim() || `rg failed (exit ${exitCode})` };
}

/**
 * Build a friendly "path not found" message, optionally enriched with the
 * parent directory's entries and similar names. Pure: takes the entry list
 * (or null), does no I/O.
 */
export function buildPathNotFoundMessage(
  searchPath: string,
  parentEntries: string[] | null,
): string {
  let msg = `Path not found: ${searchPath}`;
  if (!parentEntries || parentEntries.length === 0) return msg;

  const base = basename(searchPath).toLowerCase();
  const listing = parentEntries.slice(0, LISTING_CAP);
  const overflow = parentEntries.length - LISTING_CAP;

  if (base) {
    const similar = parentEntries
      .filter((e) => e.toLowerCase().includes(base))
      .slice(0, SIMILAR_CAP);
    if (similar.length > 0) {
      msg += `\n\nDid you mean: ${similar.map((e) => `'${e}'`).join(", ")}?`;
    }
  }

  const dir = dirname(searchPath);
  msg += `\n\nEntries in ${dir}:\n` + listing.map((e) => `  ${e}`).join("\n");
  if (overflow > 0) {
    msg += `\n  ... (${overflow} more)`;
  }
  return msg;
}

export function createFindTool(
  cwd: string,
  options?: FindToolOptions,
): AgentTool<typeof findSchema, FindToolDetails | undefined> {
  const customOps = options?.operations;
  return {
    name: "find",
    label: "find",
    description: `Find files by glob pattern or a bare name fragment (matched as a substring across the whole path, e.g. 'Button' -> '**/*Button*'). Returns file paths relative to 'path' (default: cwd). Searches all files including gitignored ones; excludes .git, node_modules, target, dist, build, .next, out.\nTips: pass 'path' to scope to a subdirectory (faster, fewer false positives); pass 'limit' (default ${DEFAULT_LIMIT}) to cap results.\nIf nothing is found, do NOT retry with minor glob variations — broaden the pattern, search a shorter fragment (the file may use snake_case or kebab-case), or list the parent directory with the read or bash tool. A directory name like 'foo' does not match files inside it; use path='foo' instead.`,
    parameters: findSchema,
    permissions: (params) => [
      { permission: "glob", patterns: [resolveGlobPattern((params as FindToolInput).pattern)] },
    ],
    async execute(
      _toolCallId: string,
      { pattern, path: searchDir, limit }: FindToolInput,
      signal?: AbortSignal,
      _onUpdate?: AgentToolUpdateCallback<FindToolDetails | undefined>,
    ) {
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }

      const searchPath = resolveToCwd(searchDir || ".", cwd);
      const effectiveLimit = limit && limit > 0 ? Math.max(1, Math.floor(limit)) : DEFAULT_LIMIT;
      const ops = customOps ?? defaultFindOperations;

      // Pre-flight: reject a missing search path once, for both branches,
      // with a friendly message enriched from the parent dir. Keeps the raw
      // rg IO error (os error 2) from leaking to callers (report 1.9).
      if (!(await ops.exists(searchPath))) {
        let parentEntries: string[] | null = null;
        const parent = dirname(searchPath);
        if (await ops.exists(parent)) {
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

      if (customOps?.glob) {
        // DI branch (tests inject a fake)
        const results = await ops.glob(pattern, searchPath, {
          ignore: EXCLUDE_GLOBS,
          limit: effectiveLimit,
        });
        if (signal?.aborted) {
          throw new Error("Operation aborted");
        }
        return formatFindResults(
          results,
          searchPath,
          effectiveLimit,
          results.length === 0,
          pattern,
        );
      }

      // Production branch: rg --files (replaces the absent fd binary).
      const rgPath = options?.rgPath ?? "rg";
      const effectivePattern = resolveGlobPattern(pattern);
      const baseArgs = [
        "--no-config",
        "--files",
        "--hidden",
        "--no-ignore",
        `--glob=${effectivePattern}`,
        ...EXCLUDE_GLOBS.map((g) => `--glob=!${g}`),
      ];

      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }

      const runList = async (): Promise<string[]> => {
        const { exitCode, stderr, stdout } = await runProcess(
          rgPath,
          [...baseArgs, searchPath],
          signal ? { signal } : {},
        );
        const outcome = classifyRgExitCode(exitCode, stdout, stderr);
        if (outcome.kind === "error") {
          throw new Error(outcome.message);
        }
        if (outcome.kind === "empty") {
          return [];
        }
        return stdout.split("\n").filter((l) => l.length > 0);
      };

      const files = await runList();

      // runProcess resolves an aborted (SIGKILL'd) rg as exit 0, so without
      // this gate the partial/empty stdout would be formatted as a file list.
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }
      return formatFindResults(files, searchPath, effectiveLimit, files.length === 0, pattern);
    },
  };
}

/** Relativize + truncate + notices. Shared by both branches. */
function formatFindResults(
  results: string[],
  searchPath: string,
  effectiveLimit: number,
  empty: boolean,
  pattern: string,
): { content: [{ type: "text"; text: string }]; details: FindToolDetails | undefined } {
  if (empty) {
    return {
      content: [
        {
          type: "text",
          text: `No files found matching '${pattern}'. Broaden the pattern, try snake_case/kebab-case variants, or list the parent directory with the read or bash tool.`,
        },
      ],
      details: undefined,
    };
  }
  const resultLimitReached = results.length > effectiveLimit;
  const capped = results.slice(0, effectiveLimit);
  const relativized = capped.map((p) => {
    if (p.startsWith(searchPath)) {
      return toPosixPath(p.slice(searchPath.length + 1));
    }
    return toPosixPath(nodePath.relative(searchPath, p));
  });
  const rawOutput = relativized.join("\n");
  const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });
  let resultOutput = truncation.content;
  const details: FindToolDetails = {};
  const notices: string[] = [];
  if (resultLimitReached) {
    notices.push(
      `${effectiveLimit} results limit reached. Try a larger limit (e.g. limit=${effectiveLimit * 2}) for more, or refine the pattern`,
    );
    details.resultLimitReached = effectiveLimit;
  }
  if (truncation.truncated) {
    notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
    details.truncation = truncation;
  }
  if (notices.length > 0) {
    resultOutput += `\n\n[${notices.join(". ")}]`;
  }
  return {
    content: [{ type: "text", text: resultOutput }],
    details: Object.keys(details).length > 0 ? details : undefined,
  };
}
