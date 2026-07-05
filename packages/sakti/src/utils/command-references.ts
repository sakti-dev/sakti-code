/**
 * Command Reference Utilities
 *
 * Utilities for transforming command references to tool-specific formats.
 */

/**
 * Transforms colon-based command references to hyphen-based format.
 * Converts `/sakti:` patterns to `/sakti-` for tools that use hyphen syntax.
 *
 * @param text - The text containing command references
 * @returns Text with command references transformed to hyphen format
 *
 * @example
 * transformToHyphenCommands('/sakti:new') // returns '/sakti-new'
 * transformToHyphenCommands('Use /sakti:apply to implement') // returns 'Use /sakti-apply to implement'
 */
export function transformToHyphenCommands(text: string): string {
  return text.replace(/\/sakti:/g, '/sakti-');
}
