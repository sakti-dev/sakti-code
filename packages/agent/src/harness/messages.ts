import type {
  ImageContent,
  Message,
  TextContent,
} from "@earendil-works/pi-ai/base";
import type { AgentMessage } from "../types.ts";

export const COMPACTION_SUMMARY_PREFIX = `The conversation history before this point was compacted into the following summary:

<summary>
`;

export const COMPACTION_SUMMARY_SUFFIX = `
</summary>`;

export const BRANCH_SUMMARY_PREFIX = `The following is a summary of a branch that this conversation came back from:

<summary>
`;

export const BRANCH_SUMMARY_SUFFIX = "</summary>";

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

export interface CustomMessage<T = unknown> {
  content: string | (TextContent | ImageContent)[];
  customType: string;
  details?: T;
  display: boolean;
  role: "custom";
  timestamp: number;
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

declare module "../types.ts" {
  interface CustomAgentMessages {
    bashExecution: BashExecutionMessage;
    branchSummary: BranchSummaryMessage;
    compactionSummary: CompactionSummaryMessage;
    custom: CustomMessage;
  }
}

export function bashExecutionToText(msg: BashExecutionMessage): string {
  let text = `Ran \`${msg.command}\`\n`;
  if (msg.output) {
    text += `\`\`\`\n${msg.output}\n\`\`\``;
  } else {
    text += "(no output)";
  }
  if (msg.cancelled) {
    text += "\n\n(command cancelled)";
  } else if (
    msg.exitCode !== null &&
    msg.exitCode !== undefined &&
    msg.exitCode !== 0
  ) {
    text += `\n\nCommand exited with code ${msg.exitCode}`;
  }
  if (msg.truncated && msg.fullOutputPath) {
    text += `\n\n[Output truncated. Full output: ${msg.fullOutputPath}]`;
  }
  return text;
}

export function createBranchSummaryMessage(
  summary: string,
  fromId: string,
  timestamp: string
): BranchSummaryMessage {
  return {
    role: "branchSummary",
    summary,
    fromId,
    timestamp: new Date(timestamp).getTime(),
  };
}

export function createCompactionSummaryMessage(
  summary: string,
  tokensBefore: number,
  timestamp: string
): CompactionSummaryMessage {
  return {
    role: "compactionSummary",
    summary,
    tokensBefore,
    timestamp: new Date(timestamp).getTime(),
  };
}

export function createCustomMessage(
  customType: string,
  content: string | (TextContent | ImageContent)[],
  display: boolean,
  details: unknown | undefined,
  timestamp: string
): CustomMessage {
  return {
    role: "custom",
    customType,
    content,
    display,
    details,
    timestamp: new Date(timestamp).getTime(),
  };
}

export function convertToLlm(messages: AgentMessage[]): Message[] {
  return messages
    .map((m): Message | undefined => {
      switch (m.role) {
        case "bashExecution":
          if (m.excludeFromContext) {
            return;
          }
          return {
            role: "user",
            content: [{ type: "text", text: bashExecutionToText(m) }],
            timestamp: m.timestamp,
          };
        case "custom": {
          const content =
            typeof m.content === "string"
              ? [{ type: "text" as const, text: m.content }]
              : m.content;
          return {
            role: "user",
            content,
            timestamp: m.timestamp,
          };
        }
        case "branchSummary":
          return {
            role: "user",
            content: [
              {
                type: "text" as const,
                text: BRANCH_SUMMARY_PREFIX + m.summary + BRANCH_SUMMARY_SUFFIX,
              },
            ],
            timestamp: m.timestamp,
          };
        case "compactionSummary":
          return {
            role: "user",
            content: [
              {
                type: "text" as const,
                text:
                  COMPACTION_SUMMARY_PREFIX +
                  m.summary +
                  COMPACTION_SUMMARY_SUFFIX,
              },
            ],
            timestamp: m.timestamp,
          };
        case "user":
        case "assistant":
        case "toolResult":
          return m;
        default:
          return;
      }
    })
    .filter((m): m is Message => m !== undefined);
}
