/**
 * Bash shell tool
 *
 * Executes bash commands with proper permission handling and output streaming
 */

import { createLogger } from "@ekacode/shared/logger";
import { tool, zodSchema } from "ai";
import { spawn, type ChildProcess } from "node:child_process";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { PermissionManager } from "../../security/permission-manager";
import { getContextOrThrow } from "../base/context";
import { validatePathOperation } from "../base/safety";
import { truncateOutput } from "../base/truncation";
import { parseCommand } from "./parser";
import { getAcceptableShell } from "./shell-selector";

const logger = createLogger("ekacode");

const DEFAULT_TIMEOUT = 120000; // 2 minutes

export const bashTool = tool({
  description: `Execute bash shell commands in the workspace.

Supports common operations like git, npm, ls, cat, etc.

- Use description field to clearly explain what the command does (5-10 words)
- timeout: Default 120000ms (2 minutes)
- workdir: Run command in specific directory (instead of using cd)
- Output is truncated to 2000 lines / 50KB
- Exit code 0 = success, non-zero = failure`,

  inputSchema: zodSchema(
    z.object({
      command: z.string().describe("The bash command to execute"),
      timeout: z.number().optional().describe("Timeout in milliseconds (default: 120000)"),
      workdir: z.string().optional().describe("Working directory (defaults to workspace root)"),
      description: z
        .string()
        .describe("Clear, concise description of what this command does (5-10 words)"),
    })
  ),

  outputSchema: zodSchema(
    z.object({
      content: z.string(),
      metadata: z.object({
        exitCode: z.number(),
        truncated: z.boolean().optional(),
        lineCount: z.number().optional(),
        description: z.string(),
      }),
    })
  ),

  execute: async ({ command, timeout = DEFAULT_TIMEOUT, workdir, description }, _options) => {
    // Get context with enhanced error message
    const { directory, sessionID } = getContextOrThrow();
    const permissionMgr = PermissionManager.getInstance();
    const toolLogger = logger.child({ module: "tool:bash", sessionID });

    // Resolve working directory
    let cwd = workdir || directory;
    if (workdir) {
      const { absolutePath } = await validatePathOperation(
        workdir,
        directory,
        "read",
        permissionMgr,
        sessionID,
        { always: ["*"] }
      );
      cwd = absolutePath;
    }

    // Validate timeout
    if (timeout < 0) {
      throw new Error(`Invalid timeout: ${timeout}. Must be positive.`);
    }

    toolLogger.debug("Executing bash command", {
      command,
      cwd,
      timeout,
    });

    // Parse command to extract file paths and patterns
    const { directories, patterns, always } = await parseCommand(command, cwd);

    // Request external directory permission if needed
    for (const dir of directories) {
      await validatePathOperation(dir, directory, "read", permissionMgr, sessionID, {
        always: ["*"],
      });
    }

    // Request bash permission
    if (patterns.size > 0) {
      const bashApproved = await permissionMgr.requestApproval({
        id: uuidv7(),
        permission: "bash",
        patterns: Array.from(patterns),
        always: Array.from(always),
        sessionID,
      });

      if (!bashApproved) {
        toolLogger.warn("Bash permission denied", { command });
        throw new Error(`Permission denied: Cannot execute command "${command}"`);
      }
    }

    // Get the shell to use
    const shell = getAcceptableShell();

    // Spawn the process
    const proc = spawn(command, {
      shell,
      cwd,
      env: {
        ...process.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    }) as ChildProcess & { exitCode: number | null };

    let output = "";

    const append = (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
    };

    proc.stdout?.on("data", append);
    proc.stderr?.on("data", append);

    let timedOut = false;
    let exited = false;

    // Import killTree dynamically to avoid circular dependency
    const { killTree } = await import("./kill-tree");

    const cleanup = async () => {
      if (!exited) {
        await killTree(proc, { exited: () => exited });
      }
    };

    // Handle timeout
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      cleanup();
    }, timeout + 100);

    // Wait for process completion
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        clearTimeout(timeoutTimer);
        resolve();
      };

      proc.once("exit", code => {
        proc.exitCode = code;
        exited = true;
        finish();
      });

      proc.once("error", error => {
        exited = true;
        finish();
        reject(error);
      });
    });

    // Build metadata
    const metadataParts: string[] = [];
    if (timedOut) {
      metadataParts.push(`Command terminated after exceeding timeout of ${timeout}ms`);
    }

    if (metadataParts.length > 0) {
      output += "\n\n<bash_metadata>\n" + metadataParts.join("\n") + "\n</bash_metadata>";
    }

    // Truncate output if needed
    const { content: finalContent, truncated, lineCount } = await truncateOutput(output);

    toolLogger.info("Bash command completed", {
      command,
      exitCode: proc.exitCode,
      truncated,
      lineCount,
    });

    return {
      content: finalContent,
      metadata: {
        exitCode: proc.exitCode || 0,
        truncated,
        lineCount,
        description,
      },
    };
  },
});
