import { FiLink } from "solid-icons/fi";
import { TOOL_ICON_CLASS, type ToolDescriptor, type ToolIconCmp } from "../store.tsx";
import { getArgs } from "../shared.ts";

const WebfetchIcon: ToolIconCmp = () => <FiLink class={TOOL_ICON_CLASS} />;

export const webfetchTool: ToolDescriptor = {
  names: ["webfetch"],
  icon: WebfetchIcon,
  summary: (p) => {
    const url = typeof getArgs(p).url === "string" ? (getArgs(p).url as string) : "";
    try {
      return `Fetched ${new URL(url).hostname}`;
    } catch {
      return "Fetched URL";
    }
  },
};
