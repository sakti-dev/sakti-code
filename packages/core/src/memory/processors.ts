/**
 * MemoryProcessor - Input/Output processors for memory integration
 *
 * Phase 4: Memory Processors Architecture
 *
 * Provides:
 * - Input processor: retrieves and injects context before agent execution
 * - Output processor: persists and triggers reflections after agent execution
 */

import type { Message as DBMessage } from "../server-bridge";
import {
  messageStorage,
  type CreateMessageInput,
  type ListMessagesOptions,
} from "./message/storage";
import { WORKING_MEMORY_TEMPLATE, workingMemoryStorage } from "./working-memory";

export interface SemanticRecallConfig {
  topK?: number;
  messageRange?: number;
  scope?: "thread" | "resource";
}

export interface MemoryProcessorInputArgs {
  message: string;
  threadId: string;
  resourceId: string;
  scope?: "thread" | "resource";
  semanticRecall?: SemanticRecallConfig;
}

export interface MemoryProcessorInputResult {
  originalMessage: string;
  workingMemory: string;
  recentMessages: CreateMessageInput[];
}

export interface MemoryProcessorOutputArgs {
  messages: Array<{
    id?: string;
    role: "user" | "assistant" | "system";
    content: string;
  }>;
  threadId: string;
  resourceId: string;
}

export interface MemoryProcessorOutputResult {
  success: boolean;
  messagesPersisted: number;
}

export class MemoryProcessor {
  static async input(args: MemoryProcessorInputArgs): Promise<MemoryProcessorInputResult> {
    const { message, threadId, resourceId } = args;

    const workingMemory = await workingMemoryStorage.getWorkingMemory(resourceId, "resource");
    const workingMemoryContent = workingMemory?.content ?? WORKING_MEMORY_TEMPLATE;

    const recallScope = args.semanticRecall?.scope ?? args.scope ?? "thread";
    const topK = Math.max(1, args.semanticRecall?.topK ?? 3);
    const messageRange = Math.max(0, args.semanticRecall?.messageRange ?? 2);

    let recentMessages: DBMessage[] = [];

    if (args.semanticRecall) {
      try {
        const matched = await messageStorage.searchMessagesWithRecency(
          message,
          topK,
          recallScope === "thread" ? threadId : undefined
        );

        if (matched.length > 0) {
          const sourceMessages = await messageStorage.listMessages(
            recallScope === "resource"
              ? ({ resourceId, limit: 200 } as ListMessagesOptions)
              : ({ threadId, limit: 200 } as ListMessagesOptions)
          );

          const selected = new Map<string, DBMessage>();
          for (const hit of matched) {
            for (const candidate of sourceMessages) {
              if (candidate.thread_id !== hit.thread_id) {
                continue;
              }
              if (Math.abs(candidate.message_index - hit.message_index) > messageRange) {
                continue;
              }
              selected.set(candidate.id, candidate);
            }
          }

          recentMessages = Array.from(selected.values()).sort((a, b) => {
            if (a.thread_id === b.thread_id) {
              return a.message_index - b.message_index;
            }
            return a.created_at.getTime() - b.created_at.getTime();
          });
        }
      } catch {
        // Fall back to recent-message retrieval when semantic recall search fails.
      }
    }

    if (recentMessages.length === 0) {
      recentMessages = await messageStorage.listMessages(
        recallScope === "resource"
          ? ({ resourceId, limit: 10 } as ListMessagesOptions)
          : ({ threadId, limit: 10 } as ListMessagesOptions)
      );
    }

    return {
      originalMessage: message,
      workingMemory: workingMemoryContent,
      recentMessages: recentMessages.map((msg: DBMessage) => ({
        id: msg.id,
        threadId: msg.thread_id,
        resourceId: msg.resource_id ?? undefined,
        role: msg.role as CreateMessageInput["role"],
        rawContent: msg.raw_content,
        searchText: msg.search_text,
        injectionText: msg.injection_text,
        createdAt: msg.created_at.getTime(),
        messageIndex: msg.message_index,
      })),
    };
  }

  static async output(args: MemoryProcessorOutputArgs): Promise<MemoryProcessorOutputResult> {
    const { messages, threadId, resourceId } = args;

    let messagesPersisted = 0;
    const messageIndex = await messageStorage.getMessageCount(threadId);

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      await messageStorage.createMessage({
        id: msg.id ?? `msg-${Date.now()}-${i}`,
        threadId,
        resourceId,
        role: msg.role,
        rawContent: msg.content,
        searchText: msg.content,
        injectionText: msg.content,
        createdAt: Date.now(),
        messageIndex: messageIndex + i,
      });
      messagesPersisted++;
    }

    return {
      success: true,
      messagesPersisted,
    };
  }

  static formatForAgentInput(
    inputResult: MemoryProcessorInputResult,
    systemPrompt: string
  ): Array<{ role: "user" | "assistant" | "system"; content: string }> {
    const messages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [
      { role: "system", content: systemPrompt },
    ];

    if (inputResult.workingMemory) {
      messages.push({
        role: "system",
        content: `<working-memory>\n${inputResult.workingMemory}\n</working-memory>`,
      });
    }

    for (const msg of inputResult.recentMessages.slice(-5)) {
      if (msg.role !== "tool") {
        messages.push({
          role: msg.role as "user" | "assistant" | "system",
          content: msg.injectionText ?? msg.rawContent,
        });
      }
    }

    messages.push({
      role: "user",
      content: inputResult.originalMessage,
    });

    return messages;
  }
}

export const memoryProcessor = {
  input: MemoryProcessor.input,
  output: MemoryProcessor.output,
  formatForAgentInput: MemoryProcessor.formatForAgentInput,
};
