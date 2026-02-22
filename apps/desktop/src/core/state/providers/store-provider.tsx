/**
 * Store Provider
 *
 * Provider-scoped store management for SSR safety and test isolation.
 * Replaces singleton store pattern with provider-scoped stores.
 *
 * Phase 1: Fixed singleton anti-pattern (R1)
 * Phase 2: Removed global fallbacks for strict provider hierarchy (R2)
 *
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <StoreProvider>
 *       <YourComponent />
 *     </StoreProvider>
 *   );
 * }
 *
 * function YourComponent() {
 *   const [messageState, messageActions] = useMessageStore();
 *   // Use store...
 * }
 * ```
 */

import {
  createMessageStore,
  createPartStore,
  createPermissionStore,
  createQuestionStore,
  createSessionStore,
} from "@/state/stores";
import type { MessageActions, MessageState } from "@/state/stores/message-store";
import type { PartActions, PartState } from "@/state/stores/part-store";
import type { PermissionActions, PermissionState } from "@/state/stores/permission-store";
import type { QuestionActions, QuestionState } from "@/state/stores/question-store";
import type { SessionActions, SessionState } from "@/state/stores/session-store";
import { Component, createContext, JSX, onCleanup, useContext } from "solid-js";

/**
 * Store context value containing all domain stores
 */
interface StoreContextValue {
  message: [get: MessageState, actions: MessageActions];
  part: [get: PartState, actions: PartActions];
  session: [get: SessionState, actions: SessionActions];
  permission: [get: PermissionState, actions: PermissionActions];
  question: [get: QuestionState, actions: QuestionActions];
}

const STORE_CONTEXT_KEY = Symbol.for("sakti-code.desktop.store-context");
const ACTIVE_STORES_KEY = Symbol.for("sakti-code.desktop.active-stores");

/**
 * Store context for provider-scoped stores
 *
 * NOTE: Previously used globalThis fallbacks for compatibility, but these
 * masked real provider initialization errors. Now strictly requires
 * StoreProvider in the component tree.
 */
const globalStoreContextRef = globalThis as typeof globalThis & {
  [STORE_CONTEXT_KEY]?: ReturnType<typeof createContext<StoreContextValue | null>>;
  [ACTIVE_STORES_KEY]?: StoreContextValue | null;
};
const StoreContext =
  globalStoreContextRef[STORE_CONTEXT_KEY] ?? createContext<StoreContextValue | null>(null);
globalStoreContextRef[STORE_CONTEXT_KEY] = StoreContext;

/**
 * StoreProvider - Creates and provides provider-scoped stores
 *
 * Each provider instance gets its own isolated stores, enabling:
 * - SSR safety (no singleton mutations across requests)
 * - Test isolation (each test gets clean state)
 * - Multiple app instances (if needed)
 */
export const StoreProvider: Component<{ children: JSX.Element }> = props => {
  const message = createMessageStore();
  const part = createPartStore();
  const session = createSessionStore();
  const permission = createPermissionStore();
  const question = createQuestionStore();
  const [, messageActions] = message;
  const [, partActions] = part;
  const [, sessionActions] = session;

  // Wire FK validation and cascade delete between stores.
  messageActions._setSessionValidator(sessionId => Boolean(sessionActions.getById(sessionId)));
  partActions._setMessageValidator(messageId => Boolean(messageActions.getById(messageId)));

  messageActions._setOnDelete(messageId => {
    const parts = partActions.getByMessage(messageId);
    for (const item of parts) {
      if (typeof item.id === "string") {
        partActions.remove(item.id, messageId);
      }
    }
  });

  sessionActions._setOnDelete(sessionId => {
    const messages = [...messageActions.getBySession(sessionId)];
    for (const item of messages) {
      messageActions.remove(item.id);
    }
  });

  const value: StoreContextValue = { message, part, session, permission, question };
  globalStoreContextRef[ACTIVE_STORES_KEY] = value;

  onCleanup(() => {
    if (globalStoreContextRef[ACTIVE_STORES_KEY] === value) {
      globalStoreContextRef[ACTIVE_STORES_KEY] = null;
    }
  });

  return <StoreContext.Provider value={value}>{props.children}</StoreContext.Provider>;
};

/**
 * Internal hook to access store context
 * @throws Error if used outside StoreProvider
 */
function useStores(): StoreContextValue {
  const context = useContext(StoreContext);
  if (context) {
    return context;
  }

  const activeStores = globalStoreContextRef[ACTIVE_STORES_KEY] ?? null;
  if (activeStores) {
    return activeStores;
  }

  throw new Error(
    "useStores must be used within StoreProvider. " +
      "Ensure your component is wrapped in a StoreProvider."
  );
}

/**
 * Hook to access message store
 * @returns [state, actions] tuple
 * @throws Error if used outside StoreProvider
 */
export function useMessageStore(): [MessageState, MessageActions] {
  return useStores().message;
}

/**
 * Hook to access part store
 * @returns [state, actions] tuple
 * @throws Error if used outside StoreProvider
 */
export function usePartStore(): [PartState, PartActions] {
  return useStores().part;
}

/**
 * Hook to access session store
 * @returns [state, actions] tuple
 * @throws Error if used outside StoreProvider
 */
export function useSessionStore(): [SessionState, SessionActions] {
  return useStores().session;
}

/**
 * Hook to access permission store
 * @returns [state, actions] tuple
 * @throws Error if used outside StoreProvider
 */
export function usePermissionStore(): [PermissionState, PermissionActions] {
  return useStores().permission;
}

/**
 * Hook to access question store
 * @returns [state, actions] tuple
 * @throws Error if used outside StoreProvider
 */
export function useQuestionStore(): [QuestionState, QuestionActions] {
  return useStores().question;
}

/**
 * Export internal useStores for advanced use cases
 */
export { useStores };
