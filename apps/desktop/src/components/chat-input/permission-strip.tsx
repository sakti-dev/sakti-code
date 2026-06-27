import type { PermissionReply } from "@sakti-code/agent";
import { FiShield } from "solid-icons/fi";
import type { JSX } from "solid-js";
import { Button } from "~/components/ui/button";
import type { PermissionPending } from "~/stores/session/session-store";

export interface PermissionStripProps {
  onReply: (reply: PermissionReply) => void;
  request: PermissionPending;
}

/**
 * Approval banner shown above the chat input when a tool requests an `"ask"`
 * permission. Mirrors the retry strip: icon + summary + action buttons.
 * Allow = once, Always = persist a session grant, Deny = reject.
 */
export function PermissionStrip(props: PermissionStripProps): JSX.Element {
  return (
    <div
      aria-live="polite"
      class="-mb-2 flex items-center gap-3 rounded-t-xl border-primary/30 border-x border-t bg-primary/10 px-3 pt-2 pb-4 text-sm"
      role="dialog"
    >
      <FiShield class="size-4 shrink-0 text-primary" />
      <div class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="truncate font-medium text-primary-foreground">
          Allow {props.request.toolName}?
        </span>
        <span class="text-muted-foreground text-xs">
          {props.request.permission} · {props.request.patterns.join(", ")}
        </span>
      </div>
      <div class="flex shrink-0 gap-2">
        <Button
          onClick={() => props.onReply("reject")}
          size="sm"
          variant="ghost"
        >
          Deny
        </Button>
        <Button
          onClick={() => props.onReply("always")}
          size="sm"
          variant="secondary"
        >
          Always
        </Button>
        <Button
          onClick={() => props.onReply("once")}
          size="sm"
          variant="primary"
        >
          Allow
        </Button>
      </div>
    </div>
  );
}
