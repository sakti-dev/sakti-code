/**
 * Context access utilities for tool execution
 *
 * Provides enhanced error messages when Instance context is missing,
 * with clear guidance on how to fix the issue.
 */

import { getContext } from "../../instance/context";

/**
 * Get the current InstanceContext with enhanced error messages
 *
 * This is a wrapper around getContext() that provides more descriptive
 * error messages for tool execution, including guidance on how to fix
 * missing context issues.
 *
 * @throws {Error} With descriptive message if called outside Instance.provide()
 * @returns The current InstanceContext
 *
 * @example
 * ```ts
 * // Inside a tool's execute function
 * const { directory, sessionID } = getContextOrThrow();
 * ```
 */
export function getContextOrThrow() {
  try {
    return getContext();
  } catch (error) {
    // Enhance the error message with more context
    const originalMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Tool executed outside of Instance.provide() context. ` +
        `Tools must be called within Instance.provide({ directory, fn }). ` +
        `Original error: ${originalMessage}`
    );
  }
}
