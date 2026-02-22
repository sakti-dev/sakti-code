/**
 * Part Queries
 *
 * Pure query functions for part data.
 */

import type { PartState } from "@/state/stores/part-store";
import type { Part } from "@sakti-code/shared/event-types";

/**
 * Get parts by message ID
 */
export function getByMessage(state: PartState, messageId: string): Part[] {
  const partIds = state.byMessage[messageId] || [];
  return partIds.map((id: string) => state.byId[id]).filter(Boolean);
}

/**
 * Get part by ID
 */
export function getById(state: PartState, partId: string): Part | undefined {
  return state.byId[partId];
}

/**
 * Get text parts for a message
 */
export function getTextParts(state: PartState, messageId: string): Part[] {
  const parts = getByMessage(state, messageId);
  return parts.filter(part => part.type === "text");
}

/**
 * Get tool call parts for a message
 */
export function getToolCallParts(state: PartState, messageId: string): Part[] {
  const parts = getByMessage(state, messageId);
  return parts.filter(part => part.type === "tool_call");
}
