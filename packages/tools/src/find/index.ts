import nodePath from "node:path";
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

export function createFindTool(
  cwd: string,
  options?: FindToolOptions,
): AgentTool<typeof findSchema, FindToolDetails | undefined> {
  const customOps = options?.operations;
  return {
    name: "find",
    label: "find",
    description: `Search for files by glob pattern (or a bare name fragment). Returns matching file paths relative to the search directory. Searches all files including gitignored ones, excluding .git and node_modules. Output is truncated to ${DEFAULT_LIMIT} results or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first); if truncated, refine your pattern.`,
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
      const effectiveLimit = limit ?? DEFAULT_LIMIT;
      const ops = customOps ?? defaultFindOperations;

      if (customOps?.glob) {
        // DI branch (tests inject a fake)
        if (!(await ops.exists(searchPath))) {
          throw new Error(`Path not found: ${searchPath}`);
        }
        if (signal?.aborted) {
          throw new Error("Operation aborted");
        }
        const results = await ops.glob(pattern, searchPath, {
          ignore: ["**/node_modules/**", "**/.git/**"],
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
        "--glob=!**/.git/**",
        "--glob=!**/node_modules/**",
        `--glob=${effectivePattern}`,
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
  const relativized = results.map((p) => {
    if (p.startsWith(searchPath)) {
      return toPosixPath(p.slice(searchPath.length + 1));
    }
    return toPosixPath(nodePath.relative(searchPath, p));
  });
  const resultLimitReached = relativized.length >= effectiveLimit;
  const rawOutput = relativized.join("\n");
  const truncation = truncateHead(rawOutput, { maxLines: Number.MAX_SAFE_INTEGER });
  let resultOutput = truncation.content;
  const details: FindToolDetails = {};
  const notices: string[] = [];
  if (resultLimitReached) {
    notices.push(
      `${effectiveLimit} results limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`,
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
