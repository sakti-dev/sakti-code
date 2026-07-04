import { FiMessageCircle } from "solid-icons/fi";
import { TOOL_ICON_CLASS, type ToolDescriptor, type ToolIconCmp } from "../store.tsx";
import { getArgs } from "../shared.ts";

const AskIcon: ToolIconCmp = () => <FiMessageCircle class={TOOL_ICON_CLASS} />;

const KIND_LABEL: Record<string, string> = {
  session: "Proposed session",
  plan: "Proposed plan",
  completion: "Ready for review",
};

export const askTool: ToolDescriptor = {
  names: ["ask"],
  icon: AskIcon,
  summary: (p) => {
    const args = getArgs(p);
    const kind = typeof args.kind === "string" ? args.kind : "";
    const body = typeof args.body === "string" ? args.body : "";
    const label = KIND_LABEL[kind] ?? "Asked the user";
    const snippet = body.length > 60 ? `${body.slice(0, 57)}...` : body;
    return snippet ? `${label}: ${snippet}` : label;
  },
};
