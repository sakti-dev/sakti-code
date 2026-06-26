import type { ImageContent, Message, TextContent } from "@sakti-code/llm";

// biome-ignore lint/complexity/noBannedTypes: extensible registry for custom message types
export type CustomAgentMessages = {};

export interface CustomMessage<T = unknown> {
  content: string | (TextContent | ImageContent)[];
  customType: string;
  details?: T;
  display: boolean;
  role: "custom";
  timestamp: number;
}

export interface BashExecutionMessage {
  cancelled: boolean;
  command: string;
  excludeFromContext?: boolean;
  exitCode: number | undefined;
  fullOutputPath?: string;
  output: string;
  role: "bashExecution";
  timestamp: number;
  truncated: boolean;
}

export interface BranchSummaryMessage {
  fromId: string;
  role: "branchSummary";
  summary: string;
  timestamp: number;
}

export interface CompactionSummaryMessage {
  role: "compactionSummary";
  summary: string;
  timestamp: number;
  tokensBefore: number;
}

export type AgentMessage =
  | Message
  | CustomMessage
  | BashExecutionMessage
  | BranchSummaryMessage
  | CompactionSummaryMessage
  | CustomAgentMessages[keyof CustomAgentMessages];
