/**
 * Message Store
 *
 * Normalized store for messages with byId lookup and ordered arrays.
 * Uses SolidJS createStore for fine-grained reactivity.
 *
 * Updated for Batch 2: Data Integrity - Added foreign key validation
 */

import type { MessageInfo } from "@ekacode/shared/event-types";
import { createStore, produce } from "solid-js/store";

/**
 * Extended message info with required id field
 */
export type MessageWithId = MessageInfo & { id: string };

/**
 * Message store state shape
 */
export interface MessageState {
  // Normalized: message ID -> message info
  byId: Record<string, MessageWithId>;
  // Ordered: message IDs per session
  bySession: Record<string, string[]>;
}

/**
 * Create empty message state
 */
export function createEmptyMessageState(): MessageState {
  return {
    byId: {},
    bySession: {},
  };
}

/**
 * Session validator function type
 */
export type SessionValidator = (sessionId: string) => boolean;

/**
 * Cascade delete callback type
 */
export type OnMessageDelete = (messageId: string) => void;

/**
 * Message store actions
 */
export interface MessageActions {
  upsert: (message: MessageWithId) => void;
  remove: (messageId: string) => void;
  getBySession: (sessionId: string) => MessageWithId[];
  getById: (messageId: string) => MessageWithId | undefined;
  /**
   * Set the session validator for foreign key checks
   * @internal Used by StoreProvider to link with session store
   */
  _setSessionValidator: (validator: SessionValidator) => void;
  /**
   * Set callback for cascade delete
   * @internal Used by StoreProvider to link with part store
   */
  _setOnDelete: (callback: OnMessageDelete) => void;
}

/**
 * Create message store with actions
 *
 * Batch 2: Data Integrity - Added FK validation
 * @param initialState - Initial state
 * @param options - Store options
 * @param options.validateSession - Function to validate session exists (FK check)
 * @param options.onValidationError - Callback when validation fails
 */
export function createMessageStore(
  initialState: MessageState = createEmptyMessageState(),
  options: {
    validateSession?: SessionValidator;
    onValidationError?: (error: Error) => void;
  } = {}
): [get: MessageState, actions: MessageActions] {
  const [state, setState] = createStore(initialState);
  let sessionValidator = options.validateSession;
  let onDeleteCallback: OnMessageDelete | undefined;

  const actions: MessageActions = {
    upsert: (message: MessageWithId) => {
      const sessionId = (message as { sessionID?: string }).sessionID;

      // Batch 2: Data Integrity - FK Validation
      if (sessionId && sessionValidator) {
        if (!sessionValidator(sessionId)) {
          const error = new Error(
            `Cannot add message ${message.id}: session ${sessionId} not found`
          );
          if (options.onValidationError) {
            options.onValidationError(error);
          } else {
            throw error;
          }
          return;
        }
      }

      setState(
        produce((draft: MessageState) => {
          // Upsert to byId
          draft.byId[message.id] = message;

          // Add to session order if not present
          if (sessionId) {
            if (!draft.bySession[sessionId]) {
              draft.bySession[sessionId] = [];
            }
            if (!draft.bySession[sessionId].includes(message.id)) {
              draft.bySession[sessionId].push(message.id);
            }
          }
        })
      );
    },

    remove: (messageId: string) => {
      const message = state.byId[messageId];
      if (!message) return;

      setState(
        produce((draft: MessageState) => {
          // Remove from byId
          delete draft.byId[messageId];

          // Remove from session order
          const sessionId = (message as { sessionID?: string }).sessionID;
          if (sessionId) {
            const sessionMessages = draft.bySession[sessionId];
            if (sessionMessages) {
              const index = sessionMessages.indexOf(messageId);
              if (index > -1) {
                sessionMessages.splice(index, 1);
              }
            }
          }
        })
      );

      // Batch 2: Data Integrity - Cascade delete
      // Notify listeners (part store) to clean up
      if (onDeleteCallback) {
        onDeleteCallback(messageId);
      }
    },

    getBySession: (sessionId: string) => {
      const messageIds = state.bySession[sessionId] || [];
      return messageIds.map((id: string) => state.byId[id]).filter(Boolean);
    },

    getById: (messageId: string) => {
      return state.byId[messageId];
    },

    _setSessionValidator: (validator: SessionValidator) => {
      sessionValidator = validator;
    },

    _setOnDelete: (callback: OnMessageDelete) => {
      onDeleteCallback = callback;
    },
  };

  return [state, actions];
}
