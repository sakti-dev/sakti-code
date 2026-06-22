import { createSignal } from "solid-js";

export const [sidebarOpen, setSidebarOpen] = createSignal(true);
export const [activeView, setActiveView] = createSignal<
  "chat" | "terminal" | "git"
>("chat");
export const [isStreaming, setIsStreaming] = createSignal(false);
