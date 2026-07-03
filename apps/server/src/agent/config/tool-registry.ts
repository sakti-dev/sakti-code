import type { AgentTool } from "@sakti-code/agent";
import {
  createAskTool,
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createReadTool,
  createWebFetchTool,
  createWebSearchTool,
  createWriteTool,
  type EditMode,
  type InMemorySnapshotStore,
  type NoopLoopGuardOwner,
  type SearchOperations,
} from "@sakti-code/tools";
import { rgPath } from "@vscode/ripgrep";

export interface ToolContext {
  readonly cwd: string;
  readonly editMode: EditMode;
  readonly noopOwner: NoopLoopGuardOwner;
  readonly snapshotStore: InMemorySnapshotStore;
  readonly websearchOperations?: SearchOperations;
}

export type ToolFactory = (ctx: ToolContext) => AgentTool;

/** Absolute path to the bundled ripgrep binary. Injected into both search tools. */
export const rgBinPath = (): string => rgPath;

/**
 * Server's tool factory registry. Names match what agents declare in
 * `toolNames`. Add new tools here when they become available; agents opt in
 * by including the name in their `toolNames` array.
 */
export const TOOL_FACTORIES: Readonly<Record<string, ToolFactory>> = {
  read: (ctx) =>
    createReadTool(ctx.cwd, {
      autoResizeImages: true,
      snapshotStore: ctx.snapshotStore,
    }) as AgentTool,
  write: (ctx) =>
    createWriteTool(ctx.cwd, {
      snapshotStore: ctx.snapshotStore,
    }) as AgentTool,
  edit: (ctx) =>
    createEditTool(ctx.cwd, {
      mode: ctx.editMode,
      snapshotStore: ctx.snapshotStore,
      noopOwner: ctx.noopOwner,
    }) as AgentTool,
  bash: (ctx) => createBashTool(ctx.cwd) as AgentTool,
  grep: (ctx) => createGrepTool(ctx.cwd, { rgPath: rgBinPath() }) as AgentTool,
  find: (ctx) => createFindTool(ctx.cwd, { rgPath: rgBinPath() }) as AgentTool,
  webfetch: () => createWebFetchTool() as AgentTool,
  websearch: (ctx) =>
    createWebSearchTool(
      ctx.websearchOperations ? { operations: ctx.websearchOperations } : {},
    ) as AgentTool,
  ask: () => createAskTool() as AgentTool,
};

/**
 * Build the tool surface for one agent. Throws on unknown tool names so a
 * typo in an agent's `toolNames` fails loudly at run start, not silently at
 * the first missing-tool call site.
 */
export function buildAgentTools(toolNames: readonly string[], ctx: ToolContext): AgentTool[] {
  return toolNames.map((name) => {
    const factory = TOOL_FACTORIES[name];
    if (!factory) {
      throw new Error(
        `Unknown tool "${name}" — not in server registry. Registered: ${Object.keys(TOOL_FACTORIES).join(", ")}`,
      );
    }
    return factory(ctx);
  });
}

/** Rebuild a single tool by name (used by the edit-mode swap path). */
export function rebuildTool(name: string, ctx: ToolContext): AgentTool {
  const factory = TOOL_FACTORIES[name];
  if (!factory) {
    throw new Error(
      `Unknown tool "${name}" — not in server registry. Registered: ${Object.keys(TOOL_FACTORIES).join(", ")}`,
    );
  }
  return factory(ctx);
}
