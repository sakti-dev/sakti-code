import type { Message, MessageInfo, Part } from "@sakti-code/core/chat";

type SessionState = {
  messages: Map<string, MessageInfo>;
  partsByMessage: Map<string, Map<string, Part>>;
};

const sessionStore = new Map<string, SessionState>();

/**
 * Clear all session data (useful for testing)
 */
export function clearSessionStore(): void {
  sessionStore.clear();
}

function ensureSession(sessionID: string): SessionState {
  let state = sessionStore.get(sessionID);
  if (!state) {
    state = {
      messages: new Map(),
      partsByMessage: new Map(),
    };
    sessionStore.set(sessionID, state);
  }
  return state;
}

function ensureMessageParts(state: SessionState, messageID: string): Map<string, Part> {
  let parts = state.partsByMessage.get(messageID);
  if (!parts) {
    parts = new Map();
    state.partsByMessage.set(messageID, parts);
  }
  return parts;
}

function infoCreatedAt(info: MessageInfo): number {
  if ("time" in info && typeof info.time?.created === "number") {
    return info.time.created;
  }
  return 0;
}

export function upsertMessage(info: MessageInfo): void {
  if (!("sessionID" in info)) return;
  const sessionID = info.sessionID;
  if (!sessionID) return;
  const state = ensureSession(sessionID);
  state.messages.set(info.id, info);
}

export function upsertPart(part: Part): void {
  const sessionID = part.sessionID;
  if (!sessionID || !part.messageID || !part.id) return;

  const state = ensureSession(sessionID);
  const parts = ensureMessageParts(state, part.messageID);
  parts.set(part.id, part);

  if (!state.messages.has(part.messageID)) {
    state.messages.set(part.messageID, {
      role: "assistant",
      id: part.messageID,
      sessionID,
      time: {
        created: Date.now(),
      },
    });
  }
}

export function removePart(input: { sessionID: string; messageID: string; partID: string }): void {
  const state = sessionStore.get(input.sessionID);
  if (!state) return;
  const parts = state.partsByMessage.get(input.messageID);
  if (!parts) return;
  parts.delete(input.partID);
  if (parts.size === 0) {
    state.partsByMessage.delete(input.messageID);
  }
}

export function getSessionMessages(sessionID: string): Message[] {
  const state = sessionStore.get(sessionID);
  if (!state) return [];

  const messages = Array.from(state.messages.values()).sort((a, b) => {
    const createdDiff = infoCreatedAt(a) - infoCreatedAt(b);
    if (createdDiff !== 0) return createdDiff;
    return a.id.localeCompare(b.id);
  });

  return messages.map(info => {
    const parts = Array.from(state.partsByMessage.get(info.id)?.values() ?? []).sort((a, b) =>
      a.id.localeCompare(b.id)
    );
    return {
      info,
      parts,
      createdAt: "time" in info ? info.time?.created : undefined,
      updatedAt: "time" in info && info.role === "assistant" ? info.time?.completed : undefined,
    };
  });
}
