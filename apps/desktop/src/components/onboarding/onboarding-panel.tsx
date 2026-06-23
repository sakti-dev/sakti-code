import { For, type JSX, Show } from "solid-js";
import { ChatInput } from "~/components/chat-input/chat-input";
import { useStore } from "~/stores/store-context";
import { WelcomePanel } from "./welcome-panel";

interface OnboardingPanelProps {
  intakeSessionId: string | null;
  projectId: string;
}

export function OnboardingPanel(props: OnboardingPanelProps): JSX.Element {
  const { sessions } = useStore();

  const sessionStore = () => {
    if (!props.intakeSessionId) {
      return null;
    }
    return sessions.get(props.intakeSessionId);
  };

  const hasMessages = () =>
    (sessionStore()?.store.messageOrder.length ?? 0) > 0;

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      <Show fallback={<WelcomePanel />} when={hasMessages()}>
        <div class="flex-1 overflow-y-auto p-4">
          <div class="mx-auto max-w-3xl">
            <For each={sessionStore()?.store.messageOrder ?? []}>
              {(msgId) => {
                const msg = sessionStore()?.store.messages[msgId];
                return (
                  <Show when={msg}>
                    {(m) => (
                      <div
                        class={`mb-3 flex ${m().role === "user" ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          class={`inline-block max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                            m().role === "user"
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-foreground"
                          }`}
                        >
                          {m().content || "…"}
                        </div>
                      </div>
                    )}
                  </Show>
                );
              }}
            </For>
          </div>
        </div>
      </Show>
      <ChatInput
        placeholder="Ask anything about this project…"
        sessionId={props.intakeSessionId}
      />
    </div>
  );
}
