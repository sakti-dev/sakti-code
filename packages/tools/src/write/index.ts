import { mkdir as fsMkdir, writeFile as fsWriteFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AgentTool, AgentToolUpdateCallback } from "@sakti-code/agent";
import { type Static, Type } from "typebox";
import { withFileMutationQueue } from "../lib/file-mutation-queue.ts";
import { formatHashlineHeader } from "../lib/hashline-utils/format.ts";
import { normalizeToLF } from "../lib/hashline-utils/normalize.ts";
import type { SnapshotStore } from "../lib/hashline-utils/snapshots.ts";
import { resolveToCwd } from "../lib/path-utils.ts";

const writeSchema = Type.Object({
  path: Type.String({
    description: "Path to the file to write (relative or absolute)",
  }),
  content: Type.String({ description: "Content to write to the file" }),
});

export type WriteToolInput = Static<typeof writeSchema>;

export interface WriteOperations {
  mkdir: (dir: string) => Promise<void>;
  writeFile: (absolutePath: string, content: string) => Promise<void>;
}

const defaultWriteOperations: WriteOperations = {
  writeFile: async (path, content) => {
    await fsWriteFile(path, content);
  },
  mkdir: (dir) => fsMkdir(dir, { recursive: true }).then(() => {}),
};

export interface WriteToolOptions {
  operations?: WriteOperations;
  snapshotStore?: SnapshotStore;
}

export function createWriteTool(
  cwd: string,
  options?: WriteToolOptions
): AgentTool<typeof writeSchema, undefined> {
  const ops = options?.operations ?? defaultWriteOperations;
  return {
    name: "write",
    label: "write",
    description:
      "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
    parameters: writeSchema,
    permissions: (params) => [
      { permission: "edit", patterns: [(params as WriteToolInput).path] },
    ],
    async execute(
      _toolCallId: string,
      { path, content }: Static<typeof writeSchema>,
      signal?: AbortSignal,
      _onUpdate?: AgentToolUpdateCallback<undefined>
    ) {
      const absolutePath = resolveToCwd(path, cwd);
      const dir = dirname(absolutePath);
      return withFileMutationQueue(absolutePath, async () => {
        const throwIfAborted = (): void => {
          if (signal?.aborted) {
            throw new Error("Operation aborted");
          }
        };

        throwIfAborted();
        await ops.mkdir(dir);
        throwIfAborted();
        await ops.writeFile(absolutePath, content);
        throwIfAborted();

        const byteSize = Buffer.byteLength(content, "utf-8");
        let outputText = `Successfully wrote ${byteSize} bytes to ${path}`;

        if (options?.snapshotStore) {
          const normalized = normalizeToLF(content);
          const hash = options.snapshotStore.record(absolutePath, normalized);
          outputText += `\n${formatHashlineHeader(path, hash)}`;
        }

        return {
          content: [
            {
              type: "text" as const,
              text: outputText,
            },
          ],
          details: undefined,
        };
      });
    },
  };
}
