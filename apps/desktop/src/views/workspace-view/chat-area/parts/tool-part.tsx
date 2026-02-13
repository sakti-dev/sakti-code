/**
 * ToolPart Component
 *
 * Renders tool execution with status indicators.
 * Dispatches to registered tool renderers or falls back to BasicTool.
 */

import { cn } from "@/utils";
import { BasicTool } from "@/views/workspace-view/chat-area/basic-tool";
import { getToolRenderer } from "@/views/workspace-view/chat-area/tool-registry";
import { type Component, type JSX } from "solid-js";

export interface ToolPartProps {
  /** The tool part data */
  part: Record<string, unknown>;
  /** Whether to start expanded */
  defaultOpen?: boolean;
  /** Whether the tool is currently streaming */
  isStreaming?: boolean;
  /** Additional CSS classes */
  class?: string;
}

// Map of tool names to icon names
const TOOL_ICONS: Record<string, string> = {
  read: "file",
  write: "file",
  edit: "file",
  bash: "terminal",
  glob: "folder",
  grep: "folder",
};

// Map of tool names to display names
const TOOL_NAMES: Record<string, string> = {
  read: "Read",
  write: "Write",
  edit: "Edit",
  bash: "Bash",
  glob: "Glob",
  grep: "Grep",
};

/**
 * Extract tool status from part data
 */
function getToolStatus(
  part: Record<string, unknown>
): "running" | "completed" | "error" | "pending" {
  const state = part.state as Record<string, unknown> | undefined;
  if (!state) return "pending";

  const status = state.status;
  if (
    status === "running" ||
    status === "completed" ||
    status === "error" ||
    status === "pending"
  ) {
    return status;
  }
  return "pending";
}

/**
 * Extract tool output from part data
 */
function getToolOutput(part: Record<string, unknown>): unknown {
  return part.output ?? (part.state as Record<string, unknown> | undefined)?.output;
}

/**
 * Extract tool name from part data
 */
function getToolName(part: Record<string, unknown>): string {
  const tool = part.tool;
  return typeof tool === "string" ? tool : "Unknown";
}

/**
 * Extract tool args from part data
 */
function getToolArgs(part: Record<string, unknown>): string | undefined {
  const args = part.args;
  if (typeof args === "string") return args;
  if (typeof args === "object" && args !== null) {
    return JSON.stringify(args);
  }
  return undefined;
}

/**
 * Format output for display
 */
function formatOutput(output: unknown): string {
  if (output === null || output === undefined) return "";
  if (typeof output === "string") return output;
  return JSON.stringify(output, null, 2);
}

/**
 * ToolPart - Renders tool execution with status indicators
 *
 * @example
 * ```tsx
 * <ToolPart
 *   part={{ type: "tool", tool: "read", state: { status: "completed" }, output: "file contents" }}
 *   defaultOpen={false}
 * />
 * ```
 */
export const ToolPart: Component<ToolPartProps> = props => {
  const toolName = () => getToolName(props.part);
  const toolStatus = () => getToolStatus(props.part);
  const toolOutput = () => getToolOutput(props.part);
  const toolArgs = () => getToolArgs(props.part);

  // Check for custom renderer
  const customRenderer = () => getToolRenderer(toolName());

  const isLocked = () => toolStatus() === "pending";

  const renderOutput = (): JSX.Element => {
    const output = toolOutput();
    if (!output) return <></>;
    return <pre class="whitespace-pre-wrap text-xs">{formatOutput(output)}</pre>;
  };

  // If custom renderer exists, use it
  if (customRenderer()) {
    const Renderer = customRenderer()!;
    return (
      <div data-component="tool-part-wrapper" class={props.class}>
        <Renderer
          part={props.part}
          status={toolStatus()}
          output={toolOutput()}
          isStreaming={props.isStreaming}
        />
      </div>
    );
  }

  // Fall back to BasicTool
  return (
    <div data-component="tool-part-wrapper" class={cn("tool-part-wrapper", props.class)}>
      <BasicTool
        trigger={{
          title: TOOL_NAMES[toolName()] ?? toolName().charAt(0).toUpperCase() + toolName().slice(1),
          args: toolArgs(),
        }}
        icon={TOOL_ICONS[toolName()]}
        status={toolStatus()}
        defaultOpen={props.defaultOpen}
        locked={isLocked()}
        hideDetails={!toolOutput()}
      >
        {renderOutput()}
      </BasicTool>
    </div>
  );
};
