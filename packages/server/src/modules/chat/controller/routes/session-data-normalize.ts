/**
 * Session data normalization
 *
 * Converts checkpoint message history into a stable, opencode-like
 * API shape: unique message IDs with normalized parts.
 */

export interface MessageInfo {
  role: "user" | "assistant" | "system";
  id: string;
  sessionID?: string;
  parentID?: string;
  time?: {
    created: number;
    completed?: number;
  };
}

export interface Part {
  id: string;
  sessionID: string;
  messageID: string;
  type: string;
  [key: string]: unknown;
}

export interface MessageResponse {
  info: MessageInfo;
  parts: Part[];
  createdAt?: number;
  updatedAt?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractContentParts(input: {
  content: unknown;
  sessionID: string;
  messageID: string;
}): Part[] {
  const parts: Part[] = [];
  let index = 0;

  const pushText = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    parts.push({
      id: `${input.messageID}-text-${String(index).padStart(4, "0")}`,
      sessionID: input.sessionID,
      messageID: input.messageID,
      type: "text",
      text: trimmed,
    });
    index += 1;
  };

  const fromUnknown = (value: unknown) => {
    if (typeof value === "string") {
      pushText(value);
      return;
    }
    if (isRecord(value) && typeof value.text === "string") {
      pushText(value.text);
      return;
    }
    if (value !== undefined) {
      try {
        pushText(JSON.stringify(value));
      } catch {
        // Ignore non-serializable values
      }
    }
  };

  const { content } = input;
  if (Array.isArray(content)) {
    for (const item of content) {
      fromUnknown(item);
    }
    return parts;
  }

  fromUnknown(content);
  return parts;
}

export function normalizeCheckpointMessages(input: {
  sessionID: string;
  rawMessages: unknown[];
}): MessageResponse[] {
  const normalized = input.rawMessages
    .map((msg, index): MessageResponse | null => {
      const m = isRecord(msg) ? msg : {};
      const generatedId = `${input.sessionID}-legacy-${String(index).padStart(6, "0")}`;

      if (m.info && m.parts) {
        const info = isRecord(m.info) ? m.info : {};
        const infoID = typeof info.id === "string" && info.id.length > 0 ? info.id : undefined;
        // Legacy checkpoints sometimes stamp every entry with sessionID as message id.
        const rawID = infoID && infoID !== input.sessionID ? infoID : generatedId;
        const role =
          info.role === "user" || info.role === "assistant" || info.role === "system"
            ? info.role
            : "assistant";
        const createdAt =
          typeof (m as { createdAt?: unknown }).createdAt === "number"
            ? ((m as { createdAt: number }).createdAt ?? Date.now())
            : Date.now();

        const rawParts = Array.isArray(m.parts) ? m.parts : [];
        let parts: Part[] = rawParts
          .map((part, partIndex): Part | null => {
            if (!isRecord(part)) return null;
            const partID =
              typeof part.id === "string" && part.id.length > 0
                ? part.id
                : `${rawID}-part-${String(partIndex).padStart(4, "0")}`;
            return {
              ...part,
              id: partID,
              sessionID:
                typeof part.sessionID === "string" && part.sessionID.length > 0
                  ? part.sessionID
                  : input.sessionID,
              messageID:
                typeof part.messageID === "string" && part.messageID.length > 0
                  ? part.messageID
                  : rawID,
              type: typeof part.type === "string" && part.type.length > 0 ? part.type : "text",
            } as Part;
          })
          .filter((part): part is Part => part !== null);
        if (parts.length === 0) {
          parts = extractContentParts({
            content: m.content ?? m.parts,
            sessionID: input.sessionID,
            messageID: rawID,
          });
        }

        return {
          info: {
            role,
            id: rawID,
            sessionID: input.sessionID,
            parentID: typeof info.parentID === "string" ? info.parentID : undefined,
            time:
              isRecord(info.time) && typeof info.time.created === "number"
                ? {
                    created: info.time.created,
                    completed:
                      typeof info.time.completed === "number" ? info.time.completed : undefined,
                  }
                : { created: createdAt },
          },
          parts,
          createdAt,
          updatedAt:
            typeof (m as { updatedAt?: unknown }).updatedAt === "number"
              ? ((m as { updatedAt: number }).updatedAt ?? undefined)
              : undefined,
        };
      }

      const role = (m.role as string) || "user";
      if (role !== "user" && role !== "assistant") {
        // Skip system/tool/internal records in legacy ModelMessage arrays.
        return null;
      }

      const messageID = typeof m.id === "string" && m.id.length > 0 ? m.id : generatedId;
      const createdAt =
        typeof m.createdAt === "number"
          ? m.createdAt
          : isRecord(m.time) && typeof m.time.created === "number"
            ? m.time.created
            : Date.now() + index;
      const parts = extractContentParts({
        content: m.content ?? m.parts,
        sessionID: input.sessionID,
        messageID,
      });

      return {
        info: {
          role,
          id: messageID,
          sessionID: input.sessionID,
          parentID: typeof m.parentID === "string" ? m.parentID : undefined,
          time: { created: createdAt },
        },
        parts,
        createdAt,
      };
    })
    .filter((message): message is MessageResponse => message !== null);

  // Ensure message IDs are unique even for malformed legacy checkpoints.
  const uniqueMessages = normalized.map(message => ({ ...message, parts: [...message.parts] }));
  const idCount = new Map<string, number>();
  for (let i = 0; i < uniqueMessages.length; i += 1) {
    const message = uniqueMessages[i];
    const seen = idCount.get(message.info.id) ?? 0;
    idCount.set(message.info.id, seen + 1);
    if (seen === 0) continue;

    const nextID = `${message.info.id}-dup-${seen}`;
    uniqueMessages[i] = {
      ...message,
      info: {
        ...message.info,
        id: nextID,
      },
      parts: message.parts.map(part => ({
        ...part,
        messageID: nextID,
      })),
    };
  }

  // Keep one message per ID (favor richer payload), then sort in stable chronological order.
  const byID = new Map<string, MessageResponse>();
  for (const message of uniqueMessages) {
    const existing = byID.get(message.info.id);
    if (!existing) {
      byID.set(message.info.id, message);
      continue;
    }
    const existingScore = (existing.parts?.length ?? 0) + (existing.updatedAt ? 1 : 0);
    const nextScore = (message.parts?.length ?? 0) + (message.updatedAt ? 1 : 0);
    if (nextScore >= existingScore) {
      byID.set(message.info.id, message);
    }
  }

  return Array.from(byID.values()).sort((a, b) => {
    const aCreated = a.createdAt ?? a.info.time?.created ?? 0;
    const bCreated = b.createdAt ?? b.info.time?.created ?? 0;
    if (aCreated !== bCreated) return aCreated - bCreated;
    return a.info.id.localeCompare(b.info.id);
  });
}
