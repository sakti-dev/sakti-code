import { createSignal } from "solid-js";

export type ConnectionStatus =
  | "open"
  | "connecting"
  | "reconnecting"
  | "closed"
  | "disposed";

export interface HealthIssue {
  message: string;
  type: string;
}

const [connectionStatus, setConnectionStatus] =
  createSignal<ConnectionStatus>("closed");
const [reconnectAttempt, setReconnectAttempt] = createSignal(0);
const [lastError, setLastError] = createSignal<string | null>(null);
const [healthIssues, setHealthIssues] = createSignal<HealthIssue[]>([]);
const [updateAvailable, setUpdateAvailable] = createSignal(false);
const [updateVersion, setUpdateVersion] = createSignal<string | null>(null);

export const connectionStore = {
  status: connectionStatus,
  reconnectAttempt,
  lastError,
  healthIssues,
  updateAvailable,
  updateVersion,
  setStatus: setConnectionStatus,
  setReconnectAttempt,
  setError: setLastError,
  setHealthIssues,
  setUpdateAvailable,
  setUpdateVersion,
};
