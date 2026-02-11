/**
 * Part Context
 *
 * Provides part state and operations for the part domain.
 * Wraps PartStore with typed API for convenient access.
 *
 * Part of Phase 4: Component Refactor with Domain Contexts
 */

import type { Part } from "@ekacode/shared/event-types";
import { usePartStore } from "@renderer/presentation/providers/store-provider";
import { Component, createContext, JSX, useContext } from "solid-js";
import {
  getById,
  getByMessage,
  getTextParts,
  getToolCallParts,
} from "../../core/domain/part/part-queries";

interface PartContextValue {
  // Queries
  getByMessage: (messageId: string) => Part[];
  getById: (partId: string) => Part | undefined;
  getTextParts: (messageId: string) => Part[];
  getToolCallParts: (messageId: string) => Part[];

  // Commands
  update: (part: Part) => void;
  remove: (partId: string, messageId: string) => void;
}

const PartContext = createContext<PartContextValue | null>(null);

export const PartProvider: Component<{ children: JSX.Element }> = props => {
  const [partState, partActions] = usePartStore();

  const value: PartContextValue = {
    getByMessage: (messageId: string) => getByMessage(partState, messageId),
    getById: (partId: string) => getById(partState, partId),
    getTextParts: (messageId: string) => getTextParts(partState, messageId),
    getToolCallParts: (messageId: string) => getToolCallParts(partState, messageId),
    update: partActions.upsert,
    remove: partActions.remove,
  };

  return <PartContext.Provider value={value}>{props.children}</PartContext.Provider>;
};

export function usePart(): PartContextValue {
  const context = useContext(PartContext);
  if (!context) {
    throw new Error("usePart must be used within PartProvider");
  }
  return context;
}
