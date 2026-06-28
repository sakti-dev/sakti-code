import { type Component, Show } from "solid-js";
import { cn } from "~/lib/utils";
import { normalizeToolName } from "../tools/tool-name.ts";
import {
  formatBashSummary,
  formatEditSummary,
  formatFindSummary,
  formatGenericToolSummary,
  formatGlobSummary,
  formatGrepSummary,
  formatLsSummary,
  formatReadSummary,
  formatTaskCreateSummary,
  formatTaskUpdateSummary,
  formatVscodeDiagnosticsSummary,
  formatWebfetchSummary,
  formatWriteSummary,
} from "../tools/tool-summary-formatters.ts";
import { ToolSummaryRow } from "../tools/tool-summary-row.tsx";
import type { PartProps } from "./part-registry.ts";

type ToolStatus = "running" | "completed" | "error" | "pending";
type ToolIcon = "file" | "folder" | "terminal" | "search";

const TOOL_ICON_MAP: Record<string, ToolIcon> = {
  bash: "terminal",
  edit: "file",
  find: "folder",
  glob: "folder",
  grep: "search",
  ls: "folder",
  read: "file",
  write: "file",
};

const ERROR_TRUNCATION_LENGTH = 80;

function mapStatus(status: string): ToolStatus {
  switch (status) {
    case "running":
      return "running";
    case "done":
      return "completed";
    case "error":
      return "error";
    default:
      return "pending";
  }
}

export const ToolPart: Component<PartProps> = (props) => {
  const toolName = () =>
    props.part.type === "tool_call"
      ? normalizeToolName(props.part.toolName)
      : "unknown";

  const toolStatus = (): ToolStatus =>
    props.part.type === "tool_call" ? mapStatus(props.part.status) : "pending";

  const toolIcon = (): ToolIcon => TOOL_ICON_MAP[toolName()] ?? "file";

  const errorMessage = (): string | undefined => {
    if (props.part.type !== "tool_call") {
      return;
    }
    if (props.part.status !== "error") {
      return;
    }
    const result = props.part.result;
    if (typeof result !== "string" || result.length === 0) {
      return;
    }
    return result.length > ERROR_TRUNCATION_LENGTH
      ? `${result.slice(0, ERROR_TRUNCATION_LENGTH - 3)}...`
      : result;
  };

  const summary = () => {
    if (props.part.type !== "tool_call") {
      return "";
    }
    const name = toolName();
    const input =
      props.part.input && typeof props.part.input === "object"
        ? (props.part.input as Record<string, unknown>)
        : {};
    const output = props.part.result;

    const part = { tool: name, args: input, output };

    switch (name) {
      case "ls":
        return formatLsSummary(part);
      case "read":
        return formatReadSummary(part);
      case "write":
        return formatWriteSummary(part);
      case "edit":
        return formatEditSummary(part);
      case "bash":
        return formatBashSummary(part);
      case "find":
        return formatFindSummary(part);
      case "glob":
        return formatGlobSummary(part);
      case "grep":
        return formatGrepSummary(part);
      case "TaskCreate":
        return formatTaskCreateSummary(part);
      case "TaskUpdate":
        return formatTaskUpdateSummary(part);
      case "webfetch":
        return formatWebfetchSummary(part);
      case "vscode_get_diagnostics":
        return formatVscodeDiagnosticsSummary(part);
      default:
        return formatGenericToolSummary(part);
    }
  };

  return (
    <Show when={props.part.type === "tool_call"}>
      <div class={cn("tool-part-wrapper")} data-component="tool-part-wrapper">
        <ToolSummaryRow
          error={errorMessage()}
          icon={toolIcon()}
          status={toolStatus()}
          summary={summary()}
        />
      </div>
    </Show>
  );
};
