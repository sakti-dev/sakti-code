import { FiFileText } from "solid-icons/fi";
import { middleEllipsisPath } from "~/lib/utils/path-utils.ts";
import { TOOL_ICON_CLASS, type ToolDescriptor, type ToolIconCmp } from "../store.tsx";
import { extractPath, PATH_MAX_LENGTH } from "../shared.ts";

const WriteIcon: ToolIconCmp = () => <FiFileText class={TOOL_ICON_CLASS} />;

export const writeTool: ToolDescriptor = {
  names: ["write", "write_to_file"],
  icon: WriteIcon,
  summary: (p) => `Created ${middleEllipsisPath(extractPath(p) ?? "unknown", PATH_MAX_LENGTH)}`,
};
