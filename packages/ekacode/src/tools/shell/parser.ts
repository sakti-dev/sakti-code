/**
 * Command parser utilities
 *
 * Uses tree-sitter to parse bash commands and extract file paths
 * for permission checking
 */

import * as fs from "node:fs/promises";
import path from "node:path";

// Lazy load tree-sitter to avoid startup cost
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let parserInstance: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function initParser(): Promise<any> {
  if (parserInstance) return parserInstance;

  try {
    const { default: Parser } = await import("tree-sitter");
    const bash = await import("tree-sitter-bash");

    parserInstance = new Parser();
    parserInstance.setLanguage(bash);
    return parserInstance;
  } catch (_e) {
    // tree-sitter not available, return null
    return null;
  }
}

/**
 * Clear the cached parser instance (for testing)
 */
export function clearCache(): void {
  parserInstance = null;
}

/**
 * Parse a bash command and extract file paths and command patterns
 */
export async function parseCommand(
  command: string,
  cwd: string
): Promise<{
  directories: Set<string>;
  patterns: Set<string>;
  always: Set<string>;
}> {
  const directories = new Set<string>();
  const patterns = new Set<string>();
  const always = new Set<string>();

  // Handle empty command
  if (!command || command.trim() === "") {
    return { directories, patterns, always };
  }

  try {
    const parser = await initParser();
    if (!parser) {
      // Parser not available, return basic patterns
      patterns.add(command);
      return { directories, patterns, always };
    }

    const tree = parser.parse(command);
    if (!tree?.rootNode) {
      patterns.add(command);
      return { directories, patterns, always };
    }

    // Commands that access file paths
    const fileCommands = new Set([
      "cd",
      "rm",
      "cp",
      "mv",
      "mkdir",
      "touch",
      "chmod",
      "chown",
      "cat",
      "ls",
      "find",
      "grep",
      "head",
      "tail",
      "less",
      "more",
      "wc",
      "sort",
    ]);

    // Find all command nodes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const visitNode = async (node: any): Promise<void> => {
      if (!node) return;

      if (node.type === "command") {
        const commandParts: string[] = [];
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (!child) continue;
          if (
            child.type === "command_name" ||
            child.type === "word" ||
            child.type === "string" ||
            child.type === "raw_string" ||
            child.type === "concatenation"
          ) {
            commandParts.push(child.text);
          }
        }

        if (commandParts.length > 0) {
          const cmdName = commandParts[0];

          // Extract file paths from file commands
          if (fileCommands.has(cmdName)) {
            for (const arg of commandParts.slice(1)) {
              if (arg.startsWith("-")) continue;
              if (cmdName === "chmod" && arg.startsWith("+")) continue;

              // Resolve the path
              const resolved = await resolvePath(arg, cwd);
              if (resolved) {
                directories.add(resolved);
              }
            }
          }

          // Add command pattern for bash permission (without file arguments)
          if (cmdName !== "cd") {
            // Separate flags from file paths for the pattern
            const patternParts = [cmdName];
            for (const arg of commandParts.slice(1)) {
              if (arg.startsWith("-") || (cmdName === "chmod" && arg.startsWith("+"))) {
                patternParts.push(arg);
              } else {
                break; // Stop at first non-flag argument
              }
            }
            const pattern = patternParts.join(" ");
            patterns.add(pattern);
            // Always allow this command prefix (just command name + *)
            always.add(cmdName + "*");
          }
        }
      }

      // Recursively visit child nodes
      for (let i = 0; i < node.childCount; i++) {
        await visitNode(node.child(i));
      }
    };

    await visitNode(tree.rootNode);
  } catch (_e) {
    // Parse failed, return basic patterns
    patterns.add(command);
  }

  return { directories, patterns, always };
}

/**
 * Resolve a path argument to an absolute path
 */
async function resolvePath(arg: string, cwd: string): Promise<string | null> {
  try {
    // Skip if it's clearly an option or flag
    if (arg.startsWith("-")) return null;

    // Skip if it contains wildcards or variables
    if (arg.includes("*") || arg.includes("?") || arg.includes("$")) return null;

    // Try to resolve as a path
    let resolved = path.isAbsolute(arg) ? arg : path.join(cwd, arg);

    // Try to realpath if it exists
    try {
      resolved = await fs.realpath(resolved);
    } catch {
      // Path doesn't exist, but that's okay - we still want to check permissions
    }

    return resolved;
  } catch {
    return null;
  }
}

/**
 * Get command prefix for "always" permission patterns
 */
export function getCommandPrefix(command: string[]): string[] {
  if (command.length === 0) return [];
  // Return all but the last argument as the prefix
  return command.slice(0, -1);
}
