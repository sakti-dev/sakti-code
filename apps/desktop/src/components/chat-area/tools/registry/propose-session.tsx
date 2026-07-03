import { FiShare } from "solid-icons/fi";
import { TOOL_ICON_CLASS, type ToolDescriptor, type ToolIconCmp } from "../store.tsx";
import { getArgs } from "../shared.ts";

const ProposeSessionIcon: ToolIconCmp = () => <FiShare class={TOOL_ICON_CLASS} />;

export const proposeSessionTool: ToolDescriptor = {
  names: ["propose_session"],
  icon: ProposeSessionIcon,
  summary: (p) => {
    const title = typeof getArgs(p).title === "string" ? (getArgs(p).title as string) : "untitled";
    return `Proposed session: ${title}`;
  },
};
