import { FiTerminal } from "solid-icons/fi";
import { TOOL_ICON_CLASS, type ToolDescriptor, type ToolIconCmp } from "../store.tsx";
import { getArgs } from "../shared.ts";

const BashIcon: ToolIconCmp = () => <FiTerminal class={TOOL_ICON_CLASS} />;

export const bashTool: ToolDescriptor = {
  names: ["bash", "run_command", "shell"],
  icon: BashIcon,
  summary: (p) => {
    const args = getArgs(p);
    const description = args.description;
    const command = typeof args.command === "string" ? args.command : "unknown command";
    const text =
      typeof description === "string" && description
        ? description
        : command.length > 60
          ? `${command.slice(0, 57)}...`
          : command;
    return `Executed: ${text}`;
  },
};
