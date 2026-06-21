import { existsSync } from "node:fs";
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

function createLocalBashOperations(): BashOperations {
  return {
    exec: async (command, cwd, { onData, signal, timeout, env }) => {
      if (!existsSync(cwd)) {
        throw new Error(
          `Working directory does not exist: ${cwd}\nCannot execute bash commands.`
        );
      }
      if (signal?.aborted) {
        throw new Error("aborted");
      }

      const shell = process.env.SHELL ?? "/bin/bash";
      const proc = Bun.spawn({
        cmd: [shell, "-c", command],
        cwd,
        env: (env ?? process.env) as Record<string, string>,
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdoutStream = proc.stdout as ReadableStream<Uint8Array>;
      const stderrStream = proc.stderr as ReadableStream<Uint8Array>;

      let timedOut = false;
      let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
      const onAbort = () => {
        proc.kill("SIGKILL");
        stdoutStream.cancel().catch(() => {});
        stderrStream.cancel().catch(() => {});
      };

      try {
        if (timeout !== undefined && timeout > 0) {
          timeoutHandle = setTimeout(() => {
            timedOut = true;
            proc.kill("SIGKILL");
            stdoutStream.cancel().catch(() => {});
            stderrStream.cancel().catch(() => {});
          }, timeout * 1000);
        }

        if (signal) {
          if (signal.aborted) {
            onAbort();
          } else {
            signal.addEventListener("abort", onAbort, { once: true });
          }
        }

        const readStream = async (stream: ReadableStream<Uint8Array>) => {
          const reader = stream.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                break;
              }
              onData(Buffer.from(value));
            }
          } catch {
            // Stream cancelled (timeout/abort)
          }
        };

        await Promise.all([readStream(stdoutStream), readStream(stderrStream)]);

        const exitCode = await proc.exited;
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
        if (exitCode !== 0) {
          const reason =
            exitCode === null
              ? "Command was killed by a signal"
              : `Command exited with code ${exitCode}`;
          throw new Error(appendStatus(outputText, reason));
        }
        return { content: [{ type: "text", text: outputText }], details };
      } finally {
        clearUpdateTimer();
      }
    },
  };
}
