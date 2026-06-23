import { createSignal } from "solid-js";

export const [sidebarOpen, setSidebarOpen] = createSignal(true);
export const [activeView, setActiveView] = createSignal<
  "chat" | "terminal" | "git"
>("chat");
export const [isStreaming, setIsStreaming] = createSignal(false);

export const [lastError, setLastError] = createSignal<string | null>(null);

export interface HealthIssue {
  message: string;
  type: string;
}
export const [healthIssues, setHealthIssues] = createSignal<HealthIssue[]>([]);

export const [updateAvailable, setUpdateAvailable] = createSignal(false);
export const [updateVersion, setUpdateVersion] = createSignal<string | null>(
  null
);
