import { Show } from "solid-js";
import { connectionStore } from "~/lib/state/connection";

export default function BannerConnection() {
  const getStatus = () => {
    const status = connectionStore.status();
    const attempt = connectionStore.reconnectAttempt();

    if (status === "connecting") {
      return {
        color: "bg-warning/10 text-warning",
        message: "Connecting to server...",
      };
    }
    if (status === "reconnecting") {
      return {
        color: "bg-warning/10 text-warning",
        message: `Reconnecting (attempt ${attempt})...`,
      };
    }
    if (status === "closed" || status === "disposed") {
      return {
        color: "bg-error/10 text-error",
        message: "Disconnected from server",
      };
    }
    return null;
  };

  return (
    <Show when={getStatus()}>
      {(statusInfo) => (
        <div
          class={`px-4 py-2 text-center font-medium text-sm ${statusInfo().color}`}
        >
          {statusInfo().message}
        </div>
      )}
    </Show>
  );
}
