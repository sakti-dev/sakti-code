import { type Component, Show } from "solid-js";
import { cn } from "~/lib/utils";
import { getToolDescriptor, normalizeToolName, toToolPartData } from "../tools/index.ts";
import type { ToolCallPart } from "../tools/shared.ts";
import { ToolSummaryRow } from "../tools/tool-summary-row.tsx";
import type { PartProps } from "./part-registry.ts";

type ToolStatus = "running" | "completed" | "error" | "pending";

const ERROR_TRUNCATION_LENGTH = 80;

export const ToolPart: Component<PartProps> = (props) => {
  const toolCallPart = (): ToolCallPart | undefined => {
    if (props.part.type !== "tool_call") return undefined;
    return props.part;
  };

  const pd = (): ReturnType<typeof toToolPartData> | undefined => {
    const tc = toolCallPart();
    return tc ? toToolPartData(tc) : undefined;
  };

  const descriptor = () => getToolDescriptor(normalizeToolName(toolCallPart()?.toolName));

  const toolStatus = (): ToolStatus => {
    const tc = toolCallPart();
    if (!tc) return "pending";
    switch (tc.status) {
      case "running":
        return "running";
      case "done":
        return "completed";
      case "error":
        return "error";
      default:
        return "pending";
    }
  };

  const errorMessage = (): string | undefined => {
    const tc = toolCallPart();
    if (!tc || tc.status !== "error") return;
    const result = tc.result;
    if (typeof result !== "string" || result.length === 0) return;
    return result.length > ERROR_TRUNCATION_LENGTH
      ? `${result.slice(0, ERROR_TRUNCATION_LENGTH - 3)}...`
      : result;
  };

  return (
    <Show when={pd()}>
      {(data) => (
        <div class={cn("tool-part-wrapper")} data-component="tool-part-wrapper">
          <ToolSummaryRow
            error={errorMessage()}
            icon={descriptor().icon}
            part={data()}
            status={toolStatus()}
            summary={descriptor().summary(data())}
          />
        </div>
      )}
    </Show>
  );
};
