import { FiSearch } from "solid-icons/fi";
import { TOOL_ICON_CLASS, type ToolDescriptor, type ToolIconCmp } from "../store.tsx";
import { getArgs } from "../shared.ts";

const GrepIcon: ToolIconCmp = () => <FiSearch class={TOOL_ICON_CLASS} />;

export const grepTool: ToolDescriptor = {
  names: ["grep", "grep_search"],
  group: "explore",
  icon: GrepIcon,
  summary: (p) => {
    const args = getArgs(p);
    const pattern = typeof args.pattern === "string" ? args.pattern : "unknown";
    const path = typeof args.path === "string" ? args.path : undefined;
    return `Searched "${pattern}" using Grep${path ? ` in ${path}` : ""}`;
  },
};
