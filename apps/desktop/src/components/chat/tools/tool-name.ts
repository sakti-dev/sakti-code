const TOOL_NAME_ALIASES: Record<string, string> = {
  apply_patch: "edit",
  file_read: "read",
  find_by_name: "ls",
  grep_search: "grep",
  multi_replace_file_content: "edit",
  read_file: "read",
  replace_file_content: "edit",
  run_command: "bash",
  shell: "bash",
  view_file: "read",
  write_to_file: "write",
};

export function normalizeToolName(toolName: string | undefined): string {
  if (!toolName) {
    return "unknown";
  }

  return TOOL_NAME_ALIASES[toolName] ?? toolName;
}
