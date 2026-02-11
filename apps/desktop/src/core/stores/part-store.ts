/**
 * Part Store
 *
 * Normalized store for message parts with byId lookup.
 *
 * Updated for Batch 2: Data Integrity - Added foreign key validation
 */

import type { Part } from "@ekacode/shared/event-types";
import { createStore, produce } from "solid-js/store";

export interface PartState {
  byId: Record<string, Part>;
  byMessage: Record<string, string[]>;
}

export function createEmptyPartState(): PartState {
  return { byId: {}, byMessage: {} };
}

/**
 * Message validator function type
 */
export type MessageValidator = (messageId: string) => boolean;

export interface PartActions {
  upsert: (part: Part) => void;
  remove: (partId: string, messageId: string) => void;
  getByMessage: (messageId: string) => Part[];
  getById: (partId: string) => Part | undefined;
  /**
   * Set the message validator for foreign key checks
   * @internal Used by StoreProvider to link with message store
   */
  _setMessageValidator: (validator: MessageValidator) => void;
}

/**
 * Create part store with actions
 *
 * Batch 2: Data Integrity - Added FK validation
 * @param initialState - Initial state
 * @param options - Store options
 * @param options.validateMessage - Function to validate message exists (FK check)
 * @param options.onValidationError - Callback when validation fails
 */
export function createPartStore(
  initialState: PartState = createEmptyPartState(),
  options: {
    validateMessage?: MessageValidator;
    onValidationError?: (error: Error) => void;
  } = {}
): [get: PartState, actions: PartActions] {
  const [state, setState] = createStore(initialState);
  let messageValidator = options.validateMessage;

  const actions: PartActions = {
    upsert: (part: Part) => {
      const partId = part.id || "";
      const messageId = part.messageID || "";

      // Batch 2: Data Integrity - FK Validation
      if (messageId && messageValidator) {
        if (!messageValidator(messageId)) {
          const error = new Error(`Cannot add part ${partId}: message ${messageId} not found`);
          if (options.onValidationError) {
            options.onValidationError(error);
          } else {
            throw error;
          }
          return;
        }
      }

      setState(
        produce((draft: PartState) => {
          // Upsert to byId
          if (partId) {
            draft.byId[partId] = part;
          }

          // Add to message order if not present
          if (messageId) {
            if (!draft.byMessage[messageId]) {
              draft.byMessage[messageId] = [];
            }
            if (partId && !draft.byMessage[messageId].includes(partId)) {
              draft.byMessage[messageId].push(partId);
            }
          }
        })
      );
    },

    remove: (partId: string, messageId: string) => {
      setState(
        produce((draft: PartState) => {
          // Remove from byId
          delete draft.byId[partId];

          // Remove from message order
          const messageParts = draft.byMessage[messageId];
          if (messageParts) {
            const index = messageParts.indexOf(partId);
            if (index > -1) {
              messageParts.splice(index, 1);
            }
          }
        })
      );
    },

    getByMessage: (messageId: string) => {
      const partIds = state.byMessage[messageId] || [];
      return partIds.map((id: string) => state.byId[id]).filter(Boolean);
    },

    getById: (partId: string) => {
      return state.byId[partId];
    },

    _setMessageValidator: (validator: MessageValidator) => {
      messageValidator = validator;
    },
  };

  return [state, actions];
}
