/**
 * Message Context
 *
 * Provides message state and operations for the message domain.
 * Wraps MessageStore with typed API for convenient access.
 *
 * Part of Phase 4: Component Refactor with Domain Contexts
 */

import { useMessageStore, usePartStore } from "@renderer/presentation/providers/store-provider";
import { Component, createContext, JSX, useContext } from "solid-js";
import type { MessageWithId } from "../../core/stores/message-store";

export type MessageStatus = "unknown" | "pending" | "streaming" | "complete" | "error";

function extractTextFromPart(part: Record<string, unknown>): string {
  if (part.type !== "text") return "";
  if (typeof part.text === "string") return part.text;

  const content = part.content;
  if (content && typeof content === "object") {
    const text = (content as { text?: unknown }).text;
    return typeof text === "string" ? text : "";
  }

  return "";
}

interface MessageContextValue {
  // Queries
  getMessage: (id: string) => MessageWithId | undefined;
  getMessages: (sessionId: string) => MessageWithId[];
  getStatus: (id: string) => MessageStatus;
  getText: (id: string) => string;

  // Commands
  delete: (id: string) => void;
  copy: (id: string) => Promise<void>;
}

const MessageContext = createContext<MessageContextValue | null>(null);

export const MessageProvider: Component<{ children: JSX.Element }> = props => {
  const [, messageActions] = useMessageStore();
  const [, partActions] = usePartStore();

  const getStatus = (id: string): MessageStatus => {
    const message = messageActions.getById(id);
    if (!message) return "unknown";

    const time = (message as { time?: { created?: number; completed?: number } }).time;
    if (!time?.completed) {
      const createdAt = time?.created ?? 0;
      const now = Date.now();
      if (now - createdAt < 30000) return "streaming";
      return "pending";
    }
    return "complete";
  };

  const getText = (id: string): string => {
    const parts = partActions.getByMessage(id) as Array<Record<string, unknown>>;
    if (parts.length === 0) return "";
    return parts.map(extractTextFromPart).filter(Boolean).join("");
  };

  const deleteMsg = (id: string): void => {
    messageActions.remove(id);
  };

  const copy = async (id: string): Promise<void> => {
    const text = getText(id);
    if (!text) return;
    await navigator.clipboard.writeText(text);
  };

  const value: MessageContextValue = {
    getMessage: messageActions.getById,
    getMessages: messageActions.getBySession,
    getStatus,
    getText,
    delete: deleteMsg,
    copy,
  };

  return <MessageContext.Provider value={value}>{props.children}</MessageContext.Provider>;
};

export function useMessage(): MessageContextValue {
  const context = useContext(MessageContext);
  if (!context) {
    throw new Error("useMessage must be used within MessageProvider");
  }
  return context;
}
