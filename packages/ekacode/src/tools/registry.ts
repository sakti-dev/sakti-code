/**
 * Tool registry for agent registration
 */

import {
  applyPatchTool,
  editTool,
  globTool,
  lsTool,
  multieditTool,
  readTool,
  writeTool,
} from "./index";

export const toolRegistry = {
  read: readTool,
  write: writeTool,
  edit: editTool,
  multiedit: multieditTool,
  apply_patch: applyPatchTool,
  ls: lsTool,
  glob: globTool,

  getAll(): Record<string, unknown> {
    const { getAll: _getAll, getToolNames: _getToolNames, ...tools } = this;
    return tools as Record<string, unknown>;
  },

  getToolNames(): string[] {
    return Object.keys(this);
  },
};
