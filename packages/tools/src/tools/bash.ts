import { errMsg, validateArgs } from "../lib/shared.ts";
import { spawnCommand } from "../lib/shell.ts";
import type { ToolDefinition } from "../lib/types.ts";

export function createBashTool(
  cwd: string,
  defaultTimeout = 30_000
): ToolDefinition {
  return {
    name: "bash",
    description:
      "Execute a shell command. Returns stdout+stderr. Output truncated to 100KB. Optional timeout in seconds.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
        timeout: { type: "number", description: "Timeout in seconds" },
      },
      required: ["command"],
    },
    execute: async (_id, args, signal, onUpdate) => {
      const v = validateArgs(
        args as Record<string, unknown>,
        {
          command: { type: "string", required: true },
          timeout: { type: "number" },
        },
        "bash"
      );
      if (!v.valid) {
        return { content: v.error, terminate: false, isError: true };
      }
      const { command, timeout } = v.args as {
        command: string;
        timeout?: number;
      };
      const ms = timeout ? timeout * 1000 : defaultTimeout;
      try {
        const result = await spawnCommand(command, cwd, {
          timeout: ms,
          ...(signal ? { signal } : {}),
          ...(onUpdate ? { onUpdate } : {}),
        });
        let text = result.output || "(no output)";
        if (result.truncated) {
          text +=
            "\n\n[Output truncated. Use grep/head/tail to read specific parts.]";
        }
        if (result.timedOut) {
          return {
            content: `${text}\n\n[Command timed out after ${timeout ?? Math.round(ms / 1000)}s]`,
            terminate: false,
            isError: true,
          };
        }
        if (result.exitCode !== null && result.exitCode !== 0) {
          return { content: text, terminate: false, isError: true };
        }
        return { content: text, terminate: false };
      } catch (err: unknown) {
        return {
          content: errMsg(err),
          terminate: false,
          isError: true,
        };
      }
    },
  };
}
