export interface ToolResult {
  content: string;
  isError?: boolean;
  terminate: boolean;
}

export interface ToolDefinition {
  description: string;
  execute: (
    id: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: (p: string) => void
  ) => Promise<ToolResult>;
  name: string;
  parameters: Record<string, unknown>;
}
