import { FiLink } from "solid-icons/fi";
import { TOOL_ICON_CLASS, type ToolDescriptor, type ToolIconCmp } from "../store.tsx";
import { getArgs } from "../shared.ts";

const WebfetchIcon: ToolIconCmp = () => <FiLink class={TOOL_ICON_CLASS} />;

export const webfetchTool: ToolDescriptor = {
  names: ["webfetch"],
  icon: WebfetchIcon,
  summary: (p) => {
    const url = getArgs(p).url;
    if (typeof url !== "string") return "Fetched URL";
    try {
      return `Fetched ${new URL(url).hostname}`;
    } catch {
      return "Fetched URL";
    }
  },
};
