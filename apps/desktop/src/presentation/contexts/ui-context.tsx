/**
 * UI Context
 *
 * Provides UI-only state (selection, focus, modals, panels).
 * This state is not persisted and only exists for the current session.
 *
 * Part of Phase 4: Component Refactor with Domain Contexts
 */

import { Component, createContext, createSignal, JSX, Signal, useContext } from "solid-js";

interface UIContextValue {
  // Selection state
  selectedMessageId: Signal<string | null>;
  selectedPartId: Signal<string | null>;
  setSelectedMessage: (id: string | null) => void;
  setSelectedPart: (id: string | null) => void;

  // Focus state
  focusedInput: Signal<string | null>;
  setFocusedInput: (id: string | null) => void;

  // Modal state
  activeModal: Signal<string | null>;
  openModal: (modal: string) => void;
  closeModal: () => void;

  // Panel state
  expandedPanels: Signal<Record<string, boolean>>;
  togglePanel: (panel: string) => void;
  isPanelExpanded: (panel: string) => boolean;
}

const UIContext = createContext<UIContextValue | null>(null);

export const UIProvider: Component<{ children: JSX.Element }> = props => {
  const selectedMessageId = createSignal<string | null>(null);
  const selectedPartId = createSignal<string | null>(null);
  const focusedInput = createSignal<string | null>(null);
  const activeModal = createSignal<string | null>(null);
  const expandedPanels = createSignal<Record<string, boolean>>({});

  const value: UIContextValue = {
    selectedMessageId,
    selectedPartId,
    setSelectedMessage: (id: string | null) => selectedMessageId[1](id),
    setSelectedPart: (id: string | null) => selectedPartId[1](id),

    focusedInput,
    setFocusedInput: (id: string | null) => focusedInput[1](id),

    activeModal,
    openModal: (modal: string) => activeModal[1](modal),
    closeModal: () => activeModal[1](null),

    expandedPanels,
    togglePanel: (panel: string) => {
      const current = expandedPanels[0]();
      expandedPanels[1]({ ...current, [panel]: !current[panel] });
    },
    isPanelExpanded: (panel: string) => {
      return expandedPanels[0]()[panel] ?? false;
    },
  };

  return <UIContext.Provider value={value}>{props.children}</UIContext.Provider>;
};

export function useUI(): UIContextValue {
  const context = useContext(UIContext);
  if (!context) {
    throw new Error("useUI must be used within UIProvider");
  }
  return context;
}
