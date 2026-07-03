import { FiFileText } from "solid-icons/fi";
import { middleEllipsisPath } from "~/lib/utils/path-utils.ts";
import {
  TOOL_ICON_CLASS,
  type ToolDescriptor,
  type ToolIconCmp,
  type ToolPartData,
} from "../store.tsx";
import { extractHashlinePath, extractPath, getArgs, PATH_MAX_LENGTH } from "../shared.ts";

const EditIcon: ToolIconCmp = () => <FiFileText class={TOOL_ICON_CLASS} />;

function editedPath(part: ToolPartData): string | undefined {
  const direct = extractPath(part);
  if (direct) return direct;
  const input = getArgs(part).input;
  return typeof input === "string" ? extractHashlinePath(input) : undefined;
}

export const editTool: ToolDescriptor = {
  names: ["edit", "apply_patch", "multi_replace_file_content", "replace_file_content"],
  icon: EditIcon,
  summary: (p) => {
    const path = editedPath(p);
    return path ? `Edited ${middleEllipsisPath(path, PATH_MAX_LENGTH)}` : "Edited file";
  },
};
