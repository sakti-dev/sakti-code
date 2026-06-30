import { readdir as fsReaddir, stat as fsStat } from "node:fs/promises";
import nodePath from "node:path";
import type { AgentTool, AgentToolUpdateCallback } from "@sakti-code/agent";
import { type Static, Type } from "typebox";
import { pathExists, resolveToCwd } from "../lib/path-utils.ts";
import {
  DEFAULT_MAX_BYTES,
  formatSize,
  type TruncationResult,
  truncateHead,
} from "../lib/truncate.ts";

const lsSchema = Type.Object({
  path: Type.Optional(
    Type.String({
      description: "Directory to list (default: current directory)",
    }),
  ),
  limit: Type.Optional(
    Type.Number({
      description: "Maximum number of entries to return (default: 500)",
    }),
  ),
});

export type LsToolInput = Static<typeof lsSchema>;
const DEFAULT_LIMIT = 500;

export interface LsToolDetails {
  entryLimitReached?: number;
  truncation?: TruncationResult;
}

export interface LsOperations {
  exists: (absolutePath: string) => Promise<boolean> | boolean;
  readdir: (absolutePath: string) => Promise<string[]> | string[];
  stat: (absolutePath: string) =>
    | Promise<{ isDirectory: () => boolean }>
    | {
        isDirectory: () => boolean;
      };
}

const defaultLsOperations: LsOperations = {
  exists: pathExists,
  stat: fsStat,
  readdir: fsReaddir,
};

export interface LsToolOptions {
  operations?: LsOperations;
}

export function createLsTool(
  cwd: string,
  options?: LsToolOptions,
): AgentTool<typeof lsSchema, LsToolDetails | undefined> {
  const ops = options?.operations ?? defaultLsOperations;
  return {
    name: "ls",
    label: "ls",
    description: `List directory contents. Returns entries sorted alphabetically, with '/' suffix for directories. Includes dotfiles. Output is truncated to ${DEFAULT_LIMIT} entries or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first).`,
    parameters: lsSchema,
    permissions: (params) => [
      {
        permission: "list",
        patterns: [(params as LsToolInput).path ?? "*"],
      },
    ],
    async execute(
      _toolCallId: string,
      { path, limit }: LsToolInput,
      signal?: AbortSignal,
      _onUpdate?: AgentToolUpdateCallback<LsToolDetails | undefined>,
    ) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error("Operation aborted"));
          return;
        }

        const onAbort = () => reject(new Error("Operation aborted"));
        signal?.addEventListener("abort", onAbort, { once: true });

        (async () => {
          try {
            const dirPath = resolveToCwd(path || ".", cwd);
            const effectiveLimit = limit ?? DEFAULT_LIMIT;

            if (!(await ops.exists(dirPath))) {
              reject(new Error(`Path not found: ${dirPath}`));
              return;
            }

            const stat = await ops.stat(dirPath);
            if (!stat.isDirectory()) {
              reject(new Error(`Not a directory: ${dirPath}`));
              return;
            }

            let entries: string[];
            try {
              entries = await ops.readdir(dirPath);
            } catch (e: unknown) {
              const message = e instanceof Error ? e.message : String(e);
              reject(new Error(`Cannot read directory: ${message}`));
              return;
            }

            entries.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

            const results: string[] = [];
            let entryLimitReached = false;
            for (const entry of entries) {
              if (results.length >= effectiveLimit) {
                entryLimitReached = true;
                break;
              }

              const fullPath = nodePath.join(dirPath, entry);
              let suffix = "";
              try {
                const entryStat = await ops.stat(fullPath);
                if (entryStat.isDirectory()) {
                  suffix = "/";
                }
              } catch {
                continue;
              }
              results.push(entry + suffix);
            }

            signal?.removeEventListener("abort", onAbort);

            if (results.length === 0) {
              resolve({
                content: [{ type: "text", text: "(empty directory)" }],
                details: undefined,
              });
              return;
            }

            const rawOutput = results.join("\n");
            const truncation = truncateHead(rawOutput, {
              maxLines: Number.MAX_SAFE_INTEGER,
            });
            let output = truncation.content;
            const details: LsToolDetails = {};
            const notices: string[] = [];
            if (entryLimitReached) {
              notices.push(
                `${effectiveLimit} entries limit reached. Use limit=${effectiveLimit * 2} for more`,
              );
              details.entryLimitReached = effectiveLimit;
            }
            if (truncation.truncated) {
              notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
              details.truncation = truncation;
            }
            if (notices.length > 0) {
              output += `\n\n[${notices.join(". ")}]`;
            }

            resolve({
              content: [{ type: "text", text: output }],
              details: Object.keys(details).length > 0 ? details : undefined,
            });
          } catch (e: unknown) {
            signal?.removeEventListener("abort", onAbort);
            reject(e);
          }
        })().catch(reject);
      });
    },
  };
}
