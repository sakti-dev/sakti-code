import { spawn } from "node:child_process";
import nodePath from "node:path";
import { createInterface } from "node:readline";
import type { AgentTool, AgentToolUpdateCallback } from "@sakti-code/agent";
import { type Static, Type } from "typebox";
import { pathExists, resolveToCwd } from "../lib/path-utils.ts";
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

function resolveBin(name: string): string {
  return name;
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
    async execute(
      _toolCallId: string,
      { pattern, path: searchDir, limit }: FindToolInput,
      signal?: AbortSignal,
      _onUpdate?: AgentToolUpdateCallback<FindToolDetails | undefined>
    ) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error("Operation aborted"));
          return;
        }

        let settled = false;
        let stopChild: (() => void) | undefined;
        const settle = (fn: () => void) => {
          if (settled) {
            return;
          }
          settled = true;
          signal?.removeEventListener("abort", onAbort);
          stopChild = undefined;
          fn();
        };
        const onAbort = () => {
          stopChild?.();
          settle(() => reject(new Error("Operation aborted")));
        };
        signal?.addEventListener("abort", onAbort, { once: true });

        (async () => {
          try {
            const searchPath = resolveToCwd(searchDir || ".", cwd);
            const effectiveLimit = limit ?? DEFAULT_LIMIT;
            const ops = customOps ?? defaultFindOperations;

            if (customOps?.glob) {
              if (!(await ops.exists(searchPath))) {
                settle(() =>
                  reject(new Error(`Path not found: ${searchPath}`))
                );
                return;
              }
              if (signal?.aborted) {
                settle(() => reject(new Error("Operation aborted")));
                return;
              }
              const results = await ops.glob(pattern, searchPath, {
                ignore: ["**/node_modules/**", "**/.git/**"],
                limit: effectiveLimit,
              });
              if (signal?.aborted) {
                settle(() => reject(new Error("Operation aborted")));
                return;
              }
              if (results.length === 0) {
                settle(() =>
                  resolve({
                    content: [
                      {
                        type: "text",
                        text: "No files found matching pattern",
                      },
                    ],
                    details: undefined,
                  })
                );
                return;
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
              settle(() =>
                resolve({
                  content: [{ type: "text", text: resultOutput }],
                  details:
                    Object.keys(details).length > 0 ? details : undefined,
                })
              );
              return;
            }

            const fdPath = options?.fdPath ?? resolveBin("fd");
            if (signal?.aborted) {
              settle(() => reject(new Error("Operation aborted")));
              return;
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

            const child = spawn(fdPath, args, {
              stdio: ["ignore", "pipe", "pipe"],
            });
            const rl = createInterface({ input: child.stdout });
            let stderr = "";
            const lines: string[] = [];

            stopChild = () => {
              if (!child.killed) {
                child.kill();
              }
            };

            const cleanup = () => {
              rl.close();
            };

            child.stderr?.on("data", (chunk) => {
              stderr += chunk.toString();
            });

            rl.on("line", (line) => {
              lines.push(line);
            });

            child.on("error", (error) => {
              cleanup();
              settle(() =>
                reject(new Error(`Failed to run fd: ${error.message}`))
              );
            });

            child.on("close", (code) => {
              cleanup();
              if (signal?.aborted) {
                settle(() => reject(new Error("Operation aborted")));
                return;
              }
              const output = lines.join("\n");
              if (code !== 0) {
                const errorMsg = stderr.trim() || `fd exited with code ${code}`;
                if (!output) {
                  settle(() => reject(new Error(errorMsg)));
                  return;
                }
              }
              if (!output) {
                settle(() =>
                  resolve({
                    content: [
                      {
                        type: "text",
                        text: "No files found matching pattern",
                      },
                    ],
                    details: undefined,
                  })
                );
                return;
              }

              const relativized: string[] = [];
              for (const rawLine of lines) {
                const line = rawLine.replace(/\r$/, "").trim();
                if (!line) {
                  continue;
                }
                const hadTrailingSlash =
                  line.endsWith("/") || line.endsWith("\\");
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
              settle(() =>
                resolve({
                  content: [{ type: "text", text: resultOutput }],
                  details:
                    Object.keys(details).length > 0 ? details : undefined,
                })
              );
            });
          } catch (e) {
            if (signal?.aborted) {
              settle(() => reject(new Error("Operation aborted")));
              return;
            }
            const error = e instanceof Error ? e : new Error(String(e));
            settle(() => reject(error));
          }
        })();
      });
    },
  };
}
