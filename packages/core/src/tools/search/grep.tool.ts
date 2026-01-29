/**
 * Grep tool using ripgrep
 *
 * Searches file contents using regex patterns
 */

import { createLogger } from "@ekacode/shared/logger";
import { createTool } from "@mastra/core/tools";
import { spawn } from "node:child_process";
import path from "node:path";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { PermissionManager } from "../../security/permission-manager";
import { WorkspaceInstance } from "../../workspace/instance";
import { assertExternalDirectory } from "../base/filesystem";
import { getRipgrepPath } from "./ripgrep";

const logger = createLogger("ekacode");

const MAX_MATCHES = 100;
const MAX_LINE_LENGTH = 2000;

export const grepTool = createTool({
  id: "grep",
  description: `Search file contents using regex patterns with ripgrep.

Features:
- Fast text search with regex support
- Searches hidden files and follows symlinks
- Limits results to 100 matches
- Shows line numbers and file paths`,

  inputSchema: z.object({
    pattern: z.string().describe("The regex pattern to search for"),
    path: z.string().optional().describe("Directory to search (defaults to workspace)"),
    include: z.string().optional().describe('File pattern filter (e.g., "*.ts", "*.{js,tsx}")'),
  }),

  outputSchema: z.object({
    content: z.string(),
    metadata: z.object({
      matches: z.number(),
      truncated: z.boolean().optional(),
    }),
  }),

  execute: async ({ pattern, path: searchPath, include }, context) => {
    const workspace = WorkspaceInstance.getInstance();
    const permissionMgr = PermissionManager.getInstance();
    const sessionID = (context as { sessionID?: string })?.sessionID || uuidv7();
    const toolLogger = logger.child({ module: "tool:grep", sessionID });

    // Resolve search path
    let targetPath = searchPath || workspace.root;
    targetPath = path.isAbsolute(targetPath)
      ? targetPath
      : path.resolve(workspace.root, targetPath);

    toolLogger.debug("Searching files", {
      pattern,
      path: workspace.getRelativePath(targetPath),
      include,
    });

    // Check external directory permission
    await assertExternalDirectory(targetPath, workspace.root, async (perm, patterns) => {
      return permissionMgr.requestApproval({
        id: uuidv7(),
        permission: perm,
        patterns,
        always: [],
        sessionID,
      });
    });

    // Request grep permission (use bash permission since grep is a shell command)
    const grepApproved = await permissionMgr.requestApproval({
      id: uuidv7(),
      permission: "bash",
      patterns: [pattern],
      always: ["*"],
      sessionID,
    });

    if (!grepApproved) {
      toolLogger.warn("Grep permission denied", { pattern });
      throw new Error(`Permission denied: Cannot search for pattern "${pattern}"`);
    }

    // Get ripgrep path
    const rgPath = await getRipgrepPath();

    // Build ripgrep arguments
    const args = [
      "-nH", // line numbers, filenames
      "--hidden",
      "--follow",
      "--no-messages",
      "--field-match-separator=|",
      "--regexp",
      pattern,
    ];

    if (include) {
      args.push("--glob", include);
    }

    args.push(targetPath);

    // Spawn ripgrep
    const proc = spawn(rgPath, args, {
      cwd: targetPath,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    proc.stdout?.on("data", chunk => stdoutChunks.push(chunk));
    proc.stderr?.on("data", chunk => stderrChunks.push(chunk));

    // Wait for completion
    const exitCode = await new Promise<number>(resolve => {
      proc.once("exit", code => resolve(code || 0));
      proc.once("error", () => resolve(2));
    });

    output = Buffer.concat(stdoutChunks).toString("utf-8");
    // Reserved: _errorOutput = Buffer.concat(stderrChunks).toString("utf-8");

    // Exit codes: 0 = matches, 1 = no matches, 2 = errors
    if (exitCode === 1 || (exitCode === 2 && !output.trim())) {
      toolLogger.info("No matches found", { pattern });
      return {
        content: "No files found",
        metadata: { matches: 0, truncated: false },
      };
    }

    // Parse output
    const lines = output.trim().split("\n");
    const matches: Array<{
      path: string;
      lineNum: number;
      lineText: string;
    }> = [];

    for (const line of lines) {
      if (!line) continue;

      const parts = line.split("|");
      if (parts.length < 3) continue;

      const [filePath, lineNumStr, ...lineTextParts] = parts;
      const lineNum = parseInt(lineNumStr, 10);
      const lineText = lineTextParts.join("|");

      if (isNaN(lineNum)) continue;

      matches.push({
        path: filePath,
        lineNum,
        lineText:
          lineText.length > MAX_LINE_LENGTH
            ? lineText.substring(0, MAX_LINE_LENGTH) + "..."
            : lineText,
      });
    }

    // Limit results
    const truncated = matches.length > MAX_MATCHES;
    const finalMatches = truncated ? matches.slice(0, MAX_MATCHES) : matches;

    if (finalMatches.length === 0) {
      return {
        content: "No files found",
        metadata: { matches: 0, truncated: false },
      };
    }

    // Format output
    const outputLines = [`Found ${finalMatches.length} matches`];
    let currentFile = "";

    for (const match of finalMatches) {
      if (currentFile !== match.path) {
        if (currentFile !== "") {
          outputLines.push("");
        }
        currentFile = match.path;
        outputLines.push(`${match.path}:`);
      }
      outputLines.push(`  Line ${match.lineNum}: ${match.lineText}`);
    }

    if (truncated) {
      outputLines.push("");
      outputLines.push("(Results are truncated. Consider using a more specific path or pattern.)");
    }

    if (exitCode === 2) {
      outputLines.push("");
      outputLines.push("(Some paths were inaccessible and skipped)");
    }

    toolLogger.info("Grep search completed", {
      pattern,
      matches: finalMatches.length,
      truncated,
    });

    return {
      content: outputLines.join("\n"),
      metadata: {
        matches: finalMatches.length,
        truncated,
      },
    };
  },
});
