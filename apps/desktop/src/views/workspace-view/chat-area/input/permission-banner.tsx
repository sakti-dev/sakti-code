import { cn } from "@/utils";
import { Show, type Component } from "solid-js";

export interface PendingPermissionBannerData {
  id: string;
  toolName: string;
  description?: string;
  patterns?: string[];
}

interface PermissionBannerProps {
  permission: PendingPermissionBannerData | null | undefined;
  isResolvingPermission: boolean;
  onApproveOnce: (id: string) => void;
  onApproveAlways: (id: string, patterns?: string[]) => void;
  onDeny: (id: string) => void;
}

export const PermissionBanner: Component<PermissionBannerProps> = props => {
  return (
    <Show when={props.permission}>
      {permission => (
        <div
          data-component="permission-input-strip"
          class={cn(
            "mb-3 rounded-lg border p-3",
            "border-amber-500/30 bg-amber-500/10 text-amber-100"
          )}
        >
          <div class="mb-1 flex items-center justify-between gap-2">
            <div class="text-xs font-semibold uppercase tracking-wide">Permission required</div>
            <div class="rounded bg-amber-500/20 px-2 py-0.5 font-mono text-xs">
              {permission().toolName}
            </div>
          </div>

          <Show when={permission().description}>
            <p class="mb-2 text-xs">{permission().description}</p>
          </Show>

          <Show when={(permission().patterns?.length ?? 0) > 0}>
            <div class="mb-2 flex flex-wrap gap-1">
              {(permission().patterns ?? []).map(pattern => (
                <code class="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px]">{pattern}</code>
              ))}
            </div>
          </Show>

          <div class="flex items-center gap-2">
            <button
              type="button"
              data-action="permission-deny"
              disabled={props.isResolvingPermission}
              onClick={() => props.onDeny(permission().id)}
              class={cn(
                "rounded border border-amber-500/40 px-2 py-1 text-xs",
                "hover:bg-amber-500/20",
                "disabled:cursor-not-allowed disabled:opacity-50"
              )}
            >
              Deny
            </button>
            <button
              type="button"
              data-action="permission-approve-always"
              disabled={props.isResolvingPermission}
              onClick={() => props.onApproveAlways(permission().id, permission().patterns)}
              class={cn(
                "rounded border border-amber-500/40 px-2 py-1 text-xs",
                "hover:bg-amber-500/20",
                "disabled:cursor-not-allowed disabled:opacity-50"
              )}
            >
              Allow Always
            </button>
            <button
              type="button"
              data-action="permission-approve-once"
              disabled={props.isResolvingPermission}
              onClick={() => props.onApproveOnce(permission().id)}
              class={cn(
                "rounded bg-amber-500/30 px-2 py-1 text-xs font-medium",
                "hover:bg-amber-500/40",
                "disabled:cursor-not-allowed disabled:opacity-50"
              )}
            >
              Allow Once
            </button>
          </div>
        </div>
      )}
    </Show>
  );
};
