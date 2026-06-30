import type { PermissionReply } from "@sakti-code/agent";
import { FiAlertCircle } from "solid-icons/fi";
import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  type JSX,
  onCleanup,
  Show,
} from "solid-js";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { aggregateUsage } from "~/stores/session/usage-stats";
import { useStore } from "~/stores/store-context";
import { ChipInput, type ChipInputApi } from "./chip-input.tsx";
import { ContextMenu, type ContextMenuMode } from "./context-menu.tsx";
import { InputFooter } from "./input-footer";
import { PermissionStrip } from "./permission-strip";
import { ProfileSelect } from "./profile-select";
import { SendButton } from "./send-button";

export interface ChatInputProps {
  disabled?: boolean;
  placeholder?: string;
  sessionId: string | null;
}

export function ChatInput(props: ChatInputProps): JSX.Element {
  const { actions, api, server, sessions } = useStore();
  const [value, setValue] = createSignal("");
  const [isFocused, setIsFocused] = createSignal(false);
  let chipApi: ChipInputApi | undefined;

  // Slash/at context menu state. The chip editor owns caret bookkeeping; the
  // menu just needs to know which mode opened.
  const [menu, setMenu] = createSignal<ContextMenuMode | null>(null);

  const project = createMemo(() => {
    const sid = props.sessionId;
    if (!sid) {
      return null;
    }
    const meta = server.store.sessions[sid];
    if (!meta) {
      return null;
    }
    const p = server.store.projects[meta.projectId];
    return p ? { id: p.id, cwd: p.cwd } : null;
  });

  // Catalog (commands + skills) for the / menu — one fetch per project,
  // prefetched so the menu opens instantly.
  const [catalog] = createResource(
    () => project()?.id ?? null,
    async (pid) => {
      const res = await api.api.projects[":id"].context.$get({
        param: { id: pid },
      });
      if (!res.ok) {
        return null;
      }
      return (await res.json()) as {
        commands: { name: string; description?: string }[];
        skills: { name: string; description?: string }[];
      };
    },
  );

  // Files for the @ menu — debounced query fetch (server does frecency search).
  const [filesQuery, setFilesQuery] = createSignal("");
  let filesDebounce: ReturnType<typeof setTimeout> | undefined;
  const onFilesQuery = (q: string) => {
    clearTimeout(filesDebounce);
    filesDebounce = setTimeout(() => setFilesQuery(q), 120);
  };
  const [files] = createResource(filesQuery, async (q) => {
    const pid = project()?.id;
    if (!pid) {
      return [];
    }
    const res = await api.api.projects[":id"].files.$get({
      param: { id: pid },
      query: { query: q },
    });
    if (!res.ok) {
      return [];
    }
    const body = await res.json();
    return body.files as { path: string }[];
  });

  const closeMenu = () => {
    setMenu(null);
    // Return focus to the chip editor so the user can keep typing (Escape,
    // click outside, etc.). The pick path refocuses via insertChip too.
    queueMicrotask(() => chipApi?.focus());
  };

  const onTrigger = ({ char }: { char: ContextMenuMode }) => {
    setMenu(char);
    // Move focus to the dialog's search input so further typing filters there,
    // not in the editor.
    queueMicrotask(() => {
      const input = document.querySelector("[cmdk-input]") as HTMLInputElement | null;
      input?.focus();
    });
  };

  const isGenerating = createMemo(() => {
    if (!props.sessionId) {
      return false;
    }
    const session = sessions.get(props.sessionId);
    const phase = session.store.streaming.phase;
    return phase === "thinking" || phase === "writing" || phase === "tool_running";
  });

  const sessionStore = createMemo(() => {
    if (!props.sessionId) {
      return null;
    }
    return sessions.get(props.sessionId);
  });

  // Aggregate token/cost totals across the session's messages for the footer.
  const sessionStats = createMemo(() => {
    const s = sessionStore();
    if (!s) {
      return;
    }
    const totals = aggregateUsage(s.store.messages);
    // Hide the line entirely until there's at least one assistant turn.
    return totals.cost === 0 && totals.input === 0 && totals.output === 0 ? undefined : totals;
  });

  const retry = () => sessionStore()?.store.retry ?? null;

  const permission = () => sessionStore()?.store.permission ?? null;

  const replyPermission = (reply: PermissionReply) => {
    const req = permission();
    if (req && props.sessionId) {
      actions.replyPermission(props.sessionId, req.id, reply);
    }
  };

  const [countdown, setCountdown] = createSignal(0);

  // Tick down every second while the retry banner is visible. The effect keys
  // off the `retry()` *reference*: the reducer must replace the object on each
  // `auto_retry_start` (not mutate in place) so the countdown resets to the
  // new attempt's delay. `onCleanup` clears the interval when the retry object
  // changes or the component unmounts.
  createEffect(() => {
    const r = retry();
    if (!r) {
      setCountdown(0);
      return;
    }
    const initial = Math.max(1, Math.round(r.delayMs / 1000));
    setCountdown(initial);
    const interval = setInterval(() => {
      setCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);
    onCleanup(() => clearInterval(interval));
  });

  const canSend = () => value().trim().length > 0 && !isGenerating() && !!props.sessionId;

  const send = () => {
    if (!(canSend() && props.sessionId)) {
      return;
    }
    const text = value().trim();
    actions.sendPrompt(props.sessionId, text);
    chipApi?.clear();
  };

  return (
    <div class="w-full px-4 pb-4">
      <div class="mx-auto flex max-w-3xl flex-col">
        <Show when={retry()}>
          {(r) => (
            <div
              aria-live="polite"
              class="-mb-2 flex items-center gap-3 rounded-t-xl border-warning/30 border-x border-t bg-warning/10 px-3 pt-2 pb-4 text-sm"
              role="status"
            >
              <FiAlertCircle class="size-4 shrink-0 text-warning" />
              <div class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="truncate font-medium text-warning-foreground">{r().errorMessage}</span>
                <span class="text-muted-foreground text-xs">
                  Retrying in {countdown()}s · attempt {r().attempt} of {r().maxAttempts}
                </span>
              </div>
              {/* The strip only renders when `retry()` is set, which requires a
                  live session — but guard anyway since sessionId is a separate
                  nullable prop. */}
              <Button
                onClick={() => {
                  if (props.sessionId) {
                    actions.abortRun(props.sessionId);
                  }
                }}
                size="sm"
                variant="ghost"
              >
                Cancel
              </Button>
            </div>
          )}
        </Show>
        <Show when={permission()}>
          {(req) => <PermissionStrip onReply={replyPermission} request={req()} />}
        </Show>
        <div
          class={cn(
            "flex w-full min-w-0 flex-col gap-3 rounded-xl border p-3 shadow-lg transition-all duration-200",
            "glass-effect border-border/50 bg-background/95 backdrop-blur",
            "focus-within:ring-2 focus-within:ring-primary/20",
            isFocused() && "border-primary/40 shadow-xl",
          )}
          data-component="chat-input"
          onFocusIn={() => setIsFocused(true)}
          onFocusOut={() => setIsFocused(false)}
        >
          <ChipInput
            disabled={props.disabled}
            onChange={setValue}
            onSubmit={send}
            onTrigger={onTrigger}
            placeholder={props.placeholder ?? "Send a message…"}
            registerApi={(a) => (chipApi = a)}
          />

          <div class="flex items-center justify-end gap-2">
            <ProfileSelect sessionId={props.sessionId} />
            <SendButton canSend={canSend} isSending={isGenerating()} onClick={send} />
          </div>

          <InputFooter charCount={() => value().length} stats={sessionStats} />
        </div>
      </div>

      <ContextMenu
        commands={catalog()?.commands ?? []}
        files={files() ?? []}
        mode={menu() ?? "/"}
        onClose={closeMenu}
        onFilesQuery={onFilesQuery}
        onPick={(token) => chipApi?.insertChip(token)}
        open={menu() !== null}
        skills={catalog()?.skills ?? []}
      />
    </div>
  );
}
