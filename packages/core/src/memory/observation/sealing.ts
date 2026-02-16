/**
 * Message Sealing System for Observational Memory
 *
 * Messages are "sealed" to mark them complete for observation.
 * This prevents content merging and tracks observation boundaries.
 */

export interface MessagePart {
  type: string;
  text?: string;
  metadata?: {
    mastra?: {
      sealed?: boolean;
      sealedAt?: number;
    };
  };
}

export interface SealedMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: {
    format?: number;
    parts: MessagePart[];
    metadata?: {
      mastra?: {
        sealed?: boolean;
      };
    };
  };
  createdAt?: number;
}

/**
 * Observation markers embedded in message parts
 */
export const ObservationMarkers = {
  START: "data-om-observation-start",
  END: "data-om-observation-end",
  FAILED: "data-om-observation-failed",
} as const;

/**
 * Check if a part is an observation marker
 */
export function isObservationMarker(part: MessagePart): boolean {
  return (
    part.type === ObservationMarkers.START ||
    part.type === ObservationMarkers.END ||
    part.type === ObservationMarkers.FAILED
  );
}

/**
 * Seal a message - marks it as complete for observation
 *
 * @param message - Message to seal
 */
export function sealMessage(message: SealedMessage): void {
  // Set message-level sealed flag
  if (!message.content.metadata) {
    message.content.metadata = {};
  }
  if (!message.content.metadata.mastra) {
    message.content.metadata.mastra = {};
  }
  message.content.metadata.mastra.sealed = true;

  // Add sealedAt to last part
  const parts = message.content.parts;
  if (parts.length > 0) {
    const lastPart = parts[parts.length - 1];
    if (!lastPart.metadata) {
      lastPart.metadata = {};
    }
    if (!lastPart.metadata.mastra) {
      lastPart.metadata.mastra = {};
    }
    lastPart.metadata.mastra.sealedAt = Date.now();
  }
}

/**
 * Insert observation marker into message
 *
 * @param message - Message to modify
 * @param markerType - Type of marker to insert
 */
export function insertObservationMarker(
  message: SealedMessage,
  markerType: "start" | "end" | "failed"
): void {
  const marker: MessagePart = {
    type: `data-om-observation-${markerType}`,
    metadata: {
      mastra: {
        sealedAt: Date.now(),
      },
    },
  };

  message.content.parts.push(marker);
}

/**
 * Find the last completed observation boundary (end marker)
 *
 * @param message - Message to search
 * @returns Index of last end marker, or -1 if none found
 */
export function findLastCompletedObservationBoundary(message: SealedMessage): number {
  const parts = message.content.parts;
  if (!parts || parts.length === 0) return -1;

  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (part.type === ObservationMarkers.END) {
      return i;
    }
  }
  return -1;
}

/**
 * Get unobserved parts from a message
 * Returns parts after the last completed observation
 *
 * @param message - Message to extract parts from
 * @returns Array of unobserved parts
 */
export function getUnobservedParts(message: SealedMessage): MessagePart[] {
  const parts = message.content.parts;
  if (!parts || parts.length === 0) return [];

  // Find last completed observation (start + end)
  const endMarkerIndex = findLastCompletedObservationBoundary(message);

  if (endMarkerIndex === -1) {
    // No completed observation - all parts are unobserved
    return parts.filter(p => !isObservationMarker(p));
  }

  // Return only parts after end marker
  return parts.slice(endMarkerIndex + 1).filter(p => !isObservationMarker(p));
}

/**
 * Check if a message has been sealed
 *
 * @param message - Message to check
 * @returns true if message is sealed
 */
export function isMessageSealed(message: SealedMessage): boolean {
  return !!message.content.metadata?.mastra?.sealed;
}

/**
 * Get the timestamp when a message was sealed
 *
 * @param message - Message to check
 * @returns timestamp or undefined if not sealed
 */
export function getMessageSealedAt(message: SealedMessage): number | undefined {
  const parts = message.content.parts;
  if (parts.length === 0) return undefined;

  const lastPart = parts[parts.length - 1];
  return lastPart.metadata?.mastra?.sealedAt;
}
