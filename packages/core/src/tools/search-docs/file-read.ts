/**
 * File Read Tool - Read file contents with line range support
 *
 * Provides file reading capabilities for seeing full implementations.
 */

import { tool, zodSchema } from "ai";
import { readFileSync } from "node:fs";
import { z } from "zod";

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export type FileReadOutput = {
  content: string;
  lineCount: number;
};

// ============================================================================
// OUTPUT SCHEMA
// ============================================================================

const fileReadOutputSchema = z.object({
  content: z.string().describe("File contents"),
  lineCount: z.number().describe("Number of lines in the returned content"),
});

// ============================================================================
// TOOL DEFINITION
// ============================================================================

/**
 * Create a file_read tool
 */
export const createFileReadTool = (options: { repoPath?: string } = {}) =>
  tool({
    description: `Read file contents. Use this to:
- See full implementation of a function/class
- Understand context around AST query results
- Read specific files for detailed analysis

Supports:
- Reading entire files
- Line range selection with startLine/endLine
- Selective reading for focused analysis`,

    inputSchema: zodSchema(
      z.object({
        path: z.string().describe("File path to read (relative to repo root)"),
        startLine: z.number().optional().describe("Start at line (1-indexed)"),
        endLine: z.number().optional().describe("End at line (inclusive)"),
      })
    ),

    outputSchema: zodSchema(fileReadOutputSchema),

    execute: async args => {
      const repoPath = options.repoPath || process.cwd();
      const fullPath = args.path.startsWith("/") ? args.path : `${repoPath}/${args.path}`;

      let content = readFileSync(fullPath, "utf-8");

      // Handle line ranges
      if (args.startLine || args.endLine) {
        const lines = content.split("\n");
        const start = args.startLine || 1;
        const end = args.endLine || lines.length;
        content = lines.slice(start - 1, end).join("\n");
      }

      return fileReadOutputSchema.parse({
        content,
        lineCount: content.split("\n").length,
      });
    },
  });

/**
 * Default file_read tool instance
 */
export const fileRead = createFileReadTool();
