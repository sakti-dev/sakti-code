/**
 * Coder Agent - Filesystem operations agent
 */

import { openai } from "@ai-sdk/openai";
import { Agent } from "@mastra/core/agent";
import {
  applyPatchTool,
  editTool,
  globTool,
  lsTool,
  multieditTool,
  readTool,
  writeTool,
} from "../tools";

export const coderAgent = new Agent({
  id: "coder-agent",
  name: "Coding Agent",
  instructions: `You are an expert coding agent with filesystem access.

Available tools:
- read: Read file contents (supports offset/limit, shows line numbers)
- write: Write new files or replace existing files (shows diff)
- edit: Replace text in files (supports replaceAll)
- multiedit: Apply multiple edits at once
- applyPatch: Apply unified diff patches
- ls: List directory contents (supports recursive)
- glob: Find files by pattern

Best practices:
- Always read files before editing them
- Use write for new files, edit for modifications
- Use multiedit when making multiple related changes
- Check tool outputs for errors before proceeding
- Use glob to discover files, ls to explore directory structure`,

  model: openai("gpt-4o"),

  tools: {
    read: readTool,
    write: writeTool,
    edit: editTool,
    multiedit: multieditTool,
    applyPatch: applyPatchTool,
    ls: lsTool,
    glob: globTool,
  },
});
