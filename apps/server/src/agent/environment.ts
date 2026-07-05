import fs from "node:fs";
import path from "node:path";
import type { EnvironmentInfo } from "@sakti-code/agent";

/**
 * Gather runtime environment info for the system prompt. Called once per
 * session run; the result is formatted by `formatEnvironmentBlock` and
 * passed as the `environment` param to `composeSystemPrompt`.
 */
export function gatherEnvironmentInfo(cwd: string, modelId: string): EnvironmentInfo {
  return {
    workingDirectory: cwd,
    isGitRepo: fs.existsSync(path.join(cwd, ".git")),
    platform: process.platform,
    date: new Date().toDateString(),
    modelId,
  };
}
