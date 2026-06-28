import type { AgentTool } from "../types";

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;
const ATX_RE = /^ {0,3}#{1,6}( |\t|$)/;
const TOP_LEVEL_RE = /^ {0,3}#( |\t|$)/;

/**
 * Demote every ATX header in `description` by one level so the whole block
 * nests under a `# Tool: <name>` wrapper heading. Only triggered when a
 * level-1 header is actually present; descriptions already at `##` are
 * left untouched. Headers inside fenced code blocks are never rewritten.
 */
export function demoteHeaders(description: string): string {
  const lines = description.split("\n");

  let fence: string | undefined;
  let collides = false;
  for (const line of lines) {
    const marker = FENCE_RE.exec(line)?.[1]?.[0];
    if (marker) {
      fence =
        fence === undefined ? marker : fence === marker ? undefined : fence;
    } else if (fence === undefined && TOP_LEVEL_RE.test(line)) {
      collides = true;
      break;
    }
  }
  if (!collides) {
    return description;
  }

  fence = undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) {
      continue;
    }
    const marker = FENCE_RE.exec(line)?.[1]?.[0];
    if (marker) {
      fence =
        fence === undefined ? marker : fence === marker ? undefined : fence;
    } else if (fence === undefined && ATX_RE.test(line)) {
      lines[i] = line.replace(/^( {0,3})#/, "$1##");
    }
  }
  return lines.join("\n");
}

/**
 * Render a set of tools as `# Tool: <name>` sections for embedding in the
 * system prompt. Tools are sorted alphabetically for cache stability.
 * Each tool's description has its ATX headers demoted by one level so they
 * nest under the wrapper heading.
 */
export function renderToolInventory(tools: readonly AgentTool[]): string {
  if (tools.length === 0) {
    return "";
  }
  const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name));
  return sorted
    .map((tool) => {
      const parts = [`# Tool: ${tool.name}`];
      if (tool.description) {
        parts.push(demoteHeaders(tool.description));
      }
      return parts.join("\n");
    })
    .join("\n\n");
}
