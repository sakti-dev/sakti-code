/**
 * Grep Search Tool - Fast text search using ripgrep
 *
 * Provides fast pattern matching capabilities for searching text across files.
 */

import { tool, zodSchema } from "ai";
import { execSync } from "node:child_process";
import { z } from "zod";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type GrepMatch = {
  file: string;
  line: number;
  snippet: string;
};

export type GrepSearchOutput = {
  matches: GrepMatch[];
};

// ============================================================================
// GREP SEARCH FUNCTIONS
// ============================================================================

/**
 * Execute ripgrep search
 */
function execRipgrep(args: string[]): GrepMatch[] {
  const timeout = 30000; // 30 seconds

  try {
    const output = execSync("rg " + args.join(" "), {
      encoding: "utf-8",
      stdio: "pipe",
      timeout,
    });

    // Parse JSON output
    const lines = output.split("\n").filter(Boolean);
    const matches: GrepMatch[] = [];

    for (const line of lines) {
      try {
        const data = JSON.parse(line);
        if (data.type === "match") {
          matches.push({
            file: data.data.path.text,
            line: data.data.line_number,
            snippet: data.data.lines.text,
          });
        }
      } catch {
        // Skip non-JSON lines
      }
    }

    return matches;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr || "";
    if (stderr.includes("No matches found")) {
      return [];
    }
    throw error;
  }
}

// ============================================================================
// OUTPUT SCHEMA
// ============================================================================

const grepSearchOutputSchema = z.object({
  matches: z
    .array(
      z.object({
        file: z.string(),
        line: z.number(),
        snippet: z.string(),
      })
    )
    .describe("Matching lines with context"),
});

// ============================================================================
// TOOL DEFINITION
// ============================================================================

/**
 * Create a grep_search tool
 */
export const createGrepSearchTool = (options: { repoPath?: string } = {}) =>
  tool({
    description: `Fast text search using ripgrep. Use this for:
- Quick pattern matching (faster than AST for simple searches)
- Searching many files at once
- Finding text/regex patterns in code

Supports:
- Regex patterns
- File filtering with glob patterns
- Excluding directories
- Context lines around matches`,

    inputSchema: zodSchema(
      z.object({
        pattern: z.string().describe("Search pattern (supports regex)"),
        path: z.string().default(".").describe("Directory to search in"),
        filePattern: z.string().optional().describe('File filter (e.g., "*.ts")'),
        excludePattern: z.string().optional().describe('Exclude pattern (e.g., "node_modules")'),
        contextLines: z.number().default(2).describe("Lines of context"),
      })
    ),

    outputSchema: zodSchema(grepSearchOutputSchema),

    execute: async args => {
      const repoPath = options.repoPath || process.cwd();
      const searchPath = args.path.startsWith("/") ? args.path : `${repoPath}/${args.path}`;

      // Build ripgrep arguments
      const rgArgs = ["rg", "--json", "--no-config", "-C", String(args.contextLines)];

      if (args.filePattern) {
        rgArgs.push("-g", args.filePattern);
      }

      if (args.excludePattern) {
        rgArgs.push("-g", `!${args.excludePattern}`);
      }

      rgArgs.push(args.pattern, searchPath);

      const matches = execRipgrep(rgArgs);

      return grepSearchOutputSchema.parse({ matches });
    },
  });

/**
 * Default grep_search tool instance
 */
export const grepSearch = createGrepSearchTool();
