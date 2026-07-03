import { FiFolder } from "solid-icons/fi";
import { TOOL_ICON_CLASS, type ToolDescriptor, type ToolIconCmp } from "../store.tsx";
import { getArgs } from "../shared.ts";

const FindIcon: ToolIconCmp = () => <FiFolder class={TOOL_ICON_CLASS} />;

export const findTool: ToolDescriptor = {
  names: ["find", "find_by_name"],
  group: "explore",
  icon: FindIcon,
  summary: (p) => {
    const args = getArgs(p);
    const pattern =
      (typeof args.pattern === "string" ? args.pattern : undefined) ??
      (typeof args.glob === "string" ? args.glob : undefined) ??
      "*";
    const path = typeof args.path === "string" ? args.path : undefined;
    return `Found files matching ${pattern}${path ? ` in ${path}` : ""}`;
  },
};
