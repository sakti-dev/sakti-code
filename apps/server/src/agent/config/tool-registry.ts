import type { AgentTool } from "@sakti-code/agent";
import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createReadTool,
  createTransitionTool,
  createWebFetchTool,
  createWebSearchTool,
  createWriteTool,
  type EditMode,
  type InMemorySnapshotStore,
  type NoopLoopGuardOwner,
  type SearchOperations,
} from "@sakti-code/tools";
import { rgPath } from "@vscode/ripgrep";
import {
  analyzeWorktreeForMission,
  preflightWorktree,
  stashUnrelatedChanges,
} from "../../lib/worktree.ts";
import { resolveActiveChangeName } from "./resolve-change-name.ts";

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
  transition: (ctx) => wrapTransitionTool(ctx),
};

/**
 * Wrap the pure transition tool with a read-only git pre-flight for plan→mission.
 * If the worktree can't be created (not a git repo, no default branch), return
 * an error result with terminate:false so the agent stays alive and can inform
 * the user. The pure tool in packages/tools stays context-free.
 */
function wrapTransitionTool(ctx: ToolContext): AgentTool {
  const base = createTransitionTool();
  return {
    ...base,
    async execute(...callArgs: Parameters<AgentTool["execute"]>) {
      const args = callArgs[1] as { to?: unknown; body?: unknown; preserveUnrelated?: unknown };
      let stashedRef: string | null = null;
      if (args.to === "mission") {
        const activeChange = resolveActiveChangeName(ctx.cwd);
        const analysis = analyzeWorktreeForMission(ctx.cwd, activeChange);
        if (
          !analysis.ok &&
          analysis.code === "dirty-unrelated" &&
          args.preserveUnrelated === "stash"
        ) {
          if (!activeChange) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Cannot transition to mission: no active change was found, so Sakti cannot safely preserve unrelated changes.",
                },
              ],
              details: undefined,
              terminate: false,
            };
          }
          const stashRef = stashUnrelatedChanges(ctx.cwd, activeChange, analysis.unrelatedPaths);
          stashedRef = stashRef;
          const afterStashErr = preflightWorktree(ctx.cwd, activeChange);
          if (afterStashErr) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Cannot transition to mission after stashing unrelated changes${
                    stashRef ? ` (${stashRef})` : ""
                  }: ${afterStashErr}`,
                },
              ],
              details: undefined,
              terminate: false,
            };
          }
        } else if (!analysis.ok) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  analysis.code === "dirty-unrelated"
                    ? `Cannot transition to mission: ${analysis.message} To let Sakti stash unrelated work and continue, call transition({ to: "mission", body: ${JSON.stringify(
                        typeof args.body === "string" ? args.body : "mission brief",
                      )}, preserveUnrelated: "stash" }).`
                    : `Cannot transition to mission: ${analysis.message} Fix this, then call transition({ to: "mission" }) again.`,
              },
            ],
            details: undefined,
            terminate: false,
          };
        }
      }
      const result = await base.execute(...(callArgs as Parameters<typeof base.execute>));
      if (stashedRef) {
        return {
          ...result,
          content: [
            {
              type: "text" as const,
              text: `Phase transition recorded; stashed unrelated changes as ${stashedRef}.`,
            },
          ],
        };
      }
      return result;
    },
  };
}

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
