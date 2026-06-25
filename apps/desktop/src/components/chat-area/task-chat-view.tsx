import type { AgentHarnessEvent } from "@sakti-code/agent";
import { createMemo, type JSX, onMount, Show } from "solid-js";
import { DevToolbar } from "~/components/chat-area/dev-toolbar";
import { RetryBanner } from "~/components/chat-area/retry-banner";
import { MessageTimeline } from "~/components/chat-area/timeline/message-timeline";
import { ChatInput } from "~/components/chat-input/chat-input";
import { dispatchEvent } from "~/stores/session/event-reducer";
import { createTokenBatcher } from "~/stores/session/token-batcher";
import { buildChatTurns } from "~/stores/session/turn-projection";
import { useStore } from "~/stores/store-context";
import { replayState } from "~/stores/workspace/ui-signals";

// Dev-only no-op batcher: retry simulator events never append text tokens, so
// dispatchEvent only needs a disposable batcher whose flush does nothing.
const devBatcher = createTokenBatcher(
  () => {
    /* no-op: retry simulator events carry no text tokens to flush */
  },
  { batch: false }
);

interface TaskChatViewProps {
  sessionId: string;
}

export function TaskChatView(props: TaskChatViewProps): JSX.Element {
  const { sessions, actions } = useStore();

  const sessionStore = createMemo(() => sessions.get(props.sessionId));

  onMount(() => {
    actions.loadMessages(props.sessionId);
  });

  const turns = createMemo(() => {
    const session = sessionStore();
    if (!session) {
      return [];
    }
    return buildChatTurns(
      session.store.messageOrder,
      session.store.messages,
      session.store.streaming.phase,
      session.store.turnTimings
    );
  });

  const isGenerating = () => sessionStore()?.store.streaming.phase !== "idle";

  return (
    <div class="flex min-h-0 flex-1 flex-col">
      {/* Dev-only toolbar (tree-shaken in production by the DEV gate). Surfaces
          replay controls + a retry simulator that drives the real
          auto_retry event path so the banner can be visually verified. */}
      {import.meta.env.DEV && (
        <DevToolbar
          onReplayPause={() => actions.replayPause(props.sessionId)}
          onReplayReset={() => actions.replayReset(props.sessionId)}
          onReplayResume={() => actions.replayResume(props.sessionId)}
          onReplayStart={() => actions.replayStart(props.sessionId)}
          onRetryEvent={(event: AgentHarnessEvent) => {
            // Dispatch into this session's reducer so the retry banner
            // (driven by store.retry) reacts exactly as in production.
            const session = sessions.get(props.sessionId);
            dispatchEvent(session.actions, devBatcher, event);
          }}
          replayState={replayState}
          sessionId={props.sessionId}
        />
      )}
      <MessageTimeline isStreaming={isGenerating} turns={turns} />
      <Show when={sessionStore()?.store.retry}>
        {(retry) => (
          <RetryBanner
            onCancel={() => actions.abortRun(props.sessionId)}
            retry={retry()}
          />
        )}
      </Show>
      <ChatInput placeholder="Continue working…" sessionId={props.sessionId} />
    </div>
  );
}
