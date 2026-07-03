import { FiFileText, FiFolder } from "solid-icons/fi";
import { Show } from "solid-js";
import { middleEllipsisPath } from "~/lib/utils/path-utils.ts";
import {
  TOOL_ICON_CLASS,
  type ToolDescriptor,
  type ToolIconCmp,
  type ToolPartData,
} from "../store.tsx";
import { extractPath, PATH_MAX_LENGTH } from "../shared.ts";

const isDir = (p: ToolPartData): boolean =>
  (p.details as { kind?: string } | undefined)?.kind === "directory";

const ReadIcon: ToolIconCmp = (props) => (
  <Show when={isDir(props.part)} fallback={<FiFileText class={TOOL_ICON_CLASS} />}>
    <FiFolder class={TOOL_ICON_CLASS} />
  </Show>
);

export const readTool: ToolDescriptor = {
  names: ["read", "file_read", "read_file", "view_file"],
  group: "explore",
  icon: ReadIcon,
  summary: (p) =>
    `${isDir(p) ? "List" : "Read"} ${middleEllipsisPath(extractPath(p) ?? "unknown", PATH_MAX_LENGTH)}`,
};
