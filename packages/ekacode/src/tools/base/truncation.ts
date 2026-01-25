/**
 * Output truncation utilities
 */

import { TRUNCATION_LIMITS, type TruncationResult } from "./types";

export async function truncateOutput(
  text: string,
  options: Partial<typeof TRUNCATION_LIMITS> = {}
): Promise<TruncationResult> {
  const maxLines = options.MAX_LINES ?? TRUNCATION_LIMITS.MAX_LINES;
  const maxBytes = options.MAX_BYTES ?? TRUNCATION_LIMITS.MAX_BYTES;

  const lines = text.split("\n");

  // Check if truncation needed
  if (lines.length <= maxLines && Buffer.byteLength(text) <= maxBytes) {
    return { content: text, truncated: false, lineCount: lines.length };
  }

  // Truncate lines
  const truncatedLines = lines.slice(0, maxLines);
  const remaining = lines.length - maxLines;

  const truncated = [...truncatedLines, "", `... (${remaining} more lines truncated)`].join("\n");

  return {
    content: truncated,
    truncated: true,
    lineCount: lines.length,
  };
}
