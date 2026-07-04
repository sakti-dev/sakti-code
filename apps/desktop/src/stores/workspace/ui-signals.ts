import { createSignal } from "solid-js";

// ── Layout / navigation ───────────────────────────────────────────
export const [sidebarOpen, setSidebarOpen] = createSignal(true);
export const [activeView, setActiveView] = createSignal<"chat" | "terminal" | "git">("chat");

// ── Streaming status ──────────────────────────────────────────────
export const [isStreaming, setIsStreaming] = createSignal(false);

// ── Error / health ────────────────────────────────────────────────
export const [lastError, setLastError] = createSignal<string | null>(null);

export interface HealthIssue {
  message: string;
  type: string;
}
export const [healthIssues, setHealthIssues] = createSignal<HealthIssue[]>([]);

// ── App update ────────────────────────────────────────────────────
export const [updateAvailable, setUpdateAvailable] = createSignal(false);
export const [updateVersion, setUpdateVersion] = createSignal<string | null>(null);
