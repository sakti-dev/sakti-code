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
      "Glob pattern to match files, e.g. '*.ts', '**/*.json', or 'src/**/*.spec.ts'",
  }),
  path: Type.Optional(
    Type.String({
      description: "Directory to search in (default: current directory)",
    })
  ),
  limit: Type.Optional(
    Type.Number({
      description: "Maximum number of results (default: 1000)",
    })
  ),
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
    options: { ignore: string[]; limit: number }
  ) => Promise<string[]> | string[];
}

const defaultFindOperations: FindOperations = {
  exists: pathExists,
  glob: () => [],
};

export interface FindToolOptions {
  fdPath?: string;
  operations?: FindOperations;
}

export function createFindTool(
  cwd: string,
  options?: FindToolOptions
): AgentTool<typeof findSchema, FindToolDetails | undefined> {
  const customOps = options?.operations;
  return {
    name: "find",
    label: "find",
    description: `Search for files by glob pattern. Returns matching file paths relative to the search directory. Respects .gitignore. Output is truncated to ${DEFAULT_LIMIT} results or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
    parameters: findSchema,
    permissions: (params) => [
      { permission: "glob", patterns: [(params as FindToolInput).pattern] },
    ],
    async execute(
      _toolCallId: string,
      { pattern, path: searchDir, limit }: FindToolInput,
      signal?: AbortSignal,
      _onUpdate?: AgentToolUpdateCallback<FindToolDetails | undefined>
    ) {
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }

      const searchPath = resolveToCwd(searchDir || ".", cwd);
      const effectiveLimit = limit ?? DEFAULT_LIMIT;
      const ops = customOps ?? defaultFindOperations;

      if (customOps?.glob) {
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
        if (results.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "No files found matching pattern",
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
        const truncation = truncateHead(rawOutput, {
          maxLines: Number.MAX_SAFE_INTEGER,
        });
        let resultOutput = truncation.content;
        const details: FindToolDetails = {};
        const notices: string[] = [];
        if (resultLimitReached) {
          notices.push(`${effectiveLimit} results limit reached`);
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

      const fdPath = options?.fdPath ?? "fd";
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }

      const args: string[] = [
        "--glob",
        "--color=never",
        "--hidden",
        "--no-require-git",
        "--max-results",
        String(effectiveLimit),
      ];

      let effectivePattern = pattern;
      if (pattern.includes("/")) {
        args.push("--full-path");
        if (
          !(pattern.startsWith("/") || pattern.startsWith("**/")) &&
          pattern !== "**"
        ) {
          effectivePattern = `**/${pattern}`;
        }
      }
      args.push("--", effectivePattern, searchPath);

      const {
        exitCode,
        stderr: stderrText,
        stdout: stdoutText,
      } = await runProcess(fdPath, args, signal ? { signal } : {});

      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }

      const output = stdoutText.trim();
      if (exitCode !== 0) {
        const errorMsg = stderrText.trim() || `fd exited with code ${exitCode}`;
        if (!output) {
          throw new Error(errorMsg);
        }
      }
      if (!output) {
        return {
          content: [
            {
              type: "text",
              text: "No files found matching pattern",
            },
          ],
          details: undefined,
        };
      }

      const lines = output.split("\n");
      const relativized: string[] = [];
      for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, "").trim();
        if (!line) {
          continue;
        }
        const hadTrailingSlash = line.endsWith("/") || line.endsWith("\\");
        let relativePath = line;
        if (line.startsWith(searchPath)) {
          relativePath = line.slice(searchPath.length + 1);
        } else {
          relativePath = nodePath.relative(searchPath, line);
        }
        if (hadTrailingSlash && !relativePath.endsWith("/")) {
          relativePath += "/";
        }
        relativized.push(toPosixPath(relativePath));
      }

      const resultLimitReached = relativized.length >= effectiveLimit;
      const rawOutput = relativized.join("\n");
      const truncation = truncateHead(rawOutput, {
        maxLines: Number.MAX_SAFE_INTEGER,
      });
      let resultOutput = truncation.content;
      const details: FindToolDetails = {};
      const notices: string[] = [];
      if (resultLimitReached) {
        notices.push(
          `${effectiveLimit} results limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`
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
    },
  };
}
