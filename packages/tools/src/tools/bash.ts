import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access as fsAccess } from "node:fs/promises";
import type { AgentTool, AgentToolUpdateCallback } from "@sakti-code/agent";
import { type Static, Type } from "typebox";
import { OutputAccumulator } from "../lib/output-accumulator.ts";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  type TruncationResult,
} from "../lib/truncate.ts";

const bashSchema = Type.Object({
  command: Type.String({ description: "Bash command to execute" }),
  timeout: Type.Optional(
    Type.Number({ description: "Timeout in seconds (optional)" })
  ),
});

export type BashToolInput = Static<typeof bashSchema>;

export interface BashToolDetails {
  fullOutputPath?: string;
  truncation?: TruncationResult;
}

export interface BashOperations {
  exec: (
    command: string,
    cwd: string,
    options: {
      onData: (data: Buffer) => void;
      signal?: AbortSignal;
      timeout?: number;
      env?: NodeJS.ProcessEnv;
    }
  ) => Promise<{ exitCode: number | null }>;
}

function waitForChildProcess(
  child: import("node:child_process").ChildProcess
): Promise<number | null> {
  return new Promise((resolve) => {
    const onExit = (code: number | null, _signal: string | null) => {
      child.off("error", onError);
      resolve(code);
    };
    const onError = () => {
      child.off("exit", onExit);
      resolve(null);
    };
    child.on("exit", onExit);
    child.on("error", onError);
  });
}

function killProcessTree(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    process.kill(pid, "SIGKILL");
  }
}

function createLocalBashOperations(): BashOperations {
  return {
    exec: async (command, cwd, { onData, signal, timeout, env }) => {
      try {
        await fsAccess(cwd, constants.F_OK);
      } catch {
        throw new Error(
          `Working directory does not exist: ${cwd}\nCannot execute bash commands.`
        );
      }
      if (signal?.aborted) {
        throw new Error("aborted");
      }

      const shell = process.env.SHELL ?? "/bin/bash";
      const child = spawn(shell, ["-c", command], {
        cwd,
        detached: process.platform !== "win32",
        env: env ?? process.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });

      let timedOut = false;
      let timeoutHandle: NodeJS.Timeout | undefined;
      const onAbort = () => {
        if (child.pid) {
          killProcessTree(child.pid);
        }
      };

      try {
        if (timeout !== undefined && timeout > 0) {
          timeoutHandle = setTimeout(() => {
            timedOut = true;
            if (child.pid) {
              killProcessTree(child.pid);
            }
          }, timeout * 1000);
        }

        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);

        if (signal) {
          if (signal.aborted) {
            onAbort();
          } else {
            signal.addEventListener("abort", onAbort, { once: true });
          }
        }

        const exitCode = await waitForChildProcess(child);
        if (signal?.aborted) {
          throw new Error("aborted");
        }
        if (timedOut) {
          throw new Error(`timeout:${timeout}`);
        }
        return { exitCode };
      } finally {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }
      }
    },
  };
}

export interface BashToolOptions {
  commandPrefix?: string;
  operations?: BashOperations;
}

const BASH_UPDATE_THROTTLE_MS = 100;

export function createBashTool(
  cwd: string,
  options?: BashToolOptions
): AgentTool<typeof bashSchema, BashToolDetails | undefined> {
  const ops = options?.operations ?? createLocalBashOperations();
  const commandPrefix = options?.commandPrefix;
  return {
    name: "bash",
    label: "bash",
    description: `Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). If truncated, full output is saved to a temp file. Optionally provide a timeout in seconds.`,
    parameters: bashSchema,
    async execute(
      _toolCallId: string,
      { command, timeout }: BashToolInput,
      signal?: AbortSignal,
      onUpdate?: AgentToolUpdateCallback<BashToolDetails | undefined>
    ) {
      const resolvedCommand = commandPrefix
        ? `${commandPrefix}\n${command}`
        : command;
      const output = new OutputAccumulator();
      let acceptingOutput = true;
      let updateTimer: NodeJS.Timeout | undefined;
      let updateDirty = false;
      let lastUpdateAt = 0;

      const emitOutputUpdate = () => {
        if (!(onUpdate && updateDirty)) {
          return;
        }
        updateDirty = false;
        lastUpdateAt = Date.now();
        const snapshot = output.snapshot({ persistIfTruncated: true });
        onUpdate({
          content: [{ type: "text", text: snapshot.content || "" }],
          details: {
            ...(snapshot.truncation.truncated
              ? { truncation: snapshot.truncation }
              : {}),
            ...(snapshot.fullOutputPath === undefined
              ? {}
              : { fullOutputPath: snapshot.fullOutputPath }),
          },
        });
      };

      const clearUpdateTimer = () => {
        if (updateTimer) {
          clearTimeout(updateTimer);
          updateTimer = undefined;
        }
      };

      const scheduleOutputUpdate = () => {
        if (!onUpdate) {
          return;
        }
        updateDirty = true;
        const delay = BASH_UPDATE_THROTTLE_MS - (Date.now() - lastUpdateAt);
        if (delay <= 0) {
          clearUpdateTimer();
          emitOutputUpdate();
          return;
        }
        updateTimer ??= setTimeout(() => {
          updateTimer = undefined;
          emitOutputUpdate();
        }, delay);
      };

      if (onUpdate) {
        onUpdate({ content: [], details: undefined });
      }

      const handleData = (data: Buffer) => {
        if (!acceptingOutput) {
          return;
        }
        output.append(data);
        scheduleOutputUpdate();
      };

      const finishOutput = async () => {
        acceptingOutput = false;
        output.finish();
        clearUpdateTimer();
        emitOutputUpdate();
        const snapshot = output.snapshot({ persistIfTruncated: true });
        await output.closeTempFile();
        return snapshot;
      };

      const formatOutput = (
        snapshot: Awaited<ReturnType<typeof finishOutput>>,
        emptyText = "(no output)"
      ) => {
        const truncation = snapshot.truncation;
        let text = snapshot.content || emptyText;
        let details: BashToolDetails | undefined;
        if (truncation.truncated) {
          details = {
            ...(truncation ? { truncation } : {}),
            ...(snapshot.fullOutputPath === undefined
              ? {}
              : { fullOutputPath: snapshot.fullOutputPath }),
          };
          const startLine = truncation.totalLines - truncation.outputLines + 1;
          const endLine = truncation.totalLines;
          if (truncation.lastLinePartial) {
            const lastLineSize = formatSize(output.getLastLineBytes());
            text += `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${lastLineSize}). Full output: ${snapshot.fullOutputPath}]`;
          } else if (truncation.truncatedBy === "lines") {
            text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${snapshot.fullOutputPath}]`;
          } else {
            text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Full output: ${snapshot.fullOutputPath}]`;
          }
        }
        return { text, details };
      };

      const appendStatus = (text: string, status: string) =>
        `${text ? `${text}\n\n` : ""}${status}`;

      try {
        let exitCode: number | null;
        try {
          const result = await ops.exec(resolvedCommand, cwd, {
            onData: handleData,
            ...(signal === undefined ? {} : { signal }),
            ...(timeout === undefined ? {} : { timeout }),
            env: process.env,
          });
          exitCode = result.exitCode;
        } catch (err) {
          const snapshot = await finishOutput();
          const { text } = formatOutput(snapshot, "");
          if (err instanceof Error && err.message === "aborted") {
            throw new Error(appendStatus(text, "Command aborted"));
          }
          if (err instanceof Error && err.message.startsWith("timeout:")) {
            const timeoutSecs = err.message.split(":")[1];
            throw new Error(
              appendStatus(
                text,
                `Command timed out after ${timeoutSecs} seconds`
              )
            );
          }
          throw err;
        }

        const snapshot = await finishOutput();
        const { text: outputText, details } = formatOutput(snapshot);
        if (exitCode !== 0 && exitCode !== null) {
          throw new Error(
            appendStatus(outputText, `Command exited with code ${exitCode}`)
          );
        }
        return { content: [{ type: "text", text: outputText }], details };
      } finally {
        clearUpdateTimer();
      }
    },
  };
}
