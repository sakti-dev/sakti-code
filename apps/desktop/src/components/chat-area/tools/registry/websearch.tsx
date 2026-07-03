import { FiGlobe } from "solid-icons/fi";
import { TOOL_ICON_CLASS, type ToolDescriptor, type ToolIconCmp } from "../store.tsx";
import { getArgs } from "../shared.ts";

const WebsearchIcon: ToolIconCmp = () => <FiGlobe class={TOOL_ICON_CLASS} />;

export const websearchTool: ToolDescriptor = {
  names: ["websearch"],
  icon: WebsearchIcon,
  summary: (p) => {
    const query = typeof getArgs(p).query === "string" ? (getArgs(p).query as string) : "";
    return `Searched the web: "${query}"`;
  },
};
