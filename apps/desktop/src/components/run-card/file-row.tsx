/**
 * FileRow Component
 *
 * Displays a single file in the Files Edited section
 */

import type { Component } from "solid-js";
import { Show } from "solid-js";
import type { RunFileData } from "../../types/ui-message";

export interface FileRowProps {
  file: RunFileData;
  onClick?: () => void;
}

/**
 * Get the file icon based on extension
 */
function getFileIcon(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "ts":
    case "tsx":
      return "📘";
    case "js":
    case "jsx":
      return "📒";
    case "css":
    case "scss":
      return "🎨";
    case "json":
      return "⚙️";
    case "md":
      return "📝";
    default:
      return "📄";
  }
}

/**
 * Get the basename from a file path
 */
function getBasename(path: string): string {
  return path.split("/").pop() || path;
}

export const FileRow: Component<FileRowProps> = props => {
  const handleClick = () => {
    if (props.onClick) {
      props.onClick();
    } else {
      // Default: send IPC to open file
      window.electron?.ipcRenderer?.send("open-file", { path: props.file.path });
    }
  };

  return (
    <div class="ag-file-row" onClick={handleClick}>
      <span class="ag-file-icon">{getFileIcon(props.file.path)}</span>
      <span class="ag-file-name" title={props.file.path}>
        {getBasename(props.file.path)}
      </span>
      <Show when={props.file.tag}>
        <span class="ag-file-tag">{props.file.tag}</span>
      </Show>
      <Show when={props.file.diff}>
        <div class="ag-file-diff">
          <span class="ag-file-diff-plus">+{props.file.diff!.plus}</span>
          <span class="ag-file-diff-minus">-{props.file.diff!.minus}</span>
        </div>
      </Show>
    </div>
  );
};

export default FileRow;
