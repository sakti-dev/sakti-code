/**
 * PermissionDialog - Modal for tool permission requests
 *
 * Displays when a tool requires user approval before execution.
 * Shows tool name, arguments, and allow/deny buttons.
 */
import type { PermissionRequestData } from "@/core/chat/types/ui-message";
import { cn } from "@/utils";
import { Component, Show } from "solid-js";

interface PermissionDialogProps {
  /** The permission request to display (null = hidden) */
  request: PermissionRequestData | null;

  /** Called when user approves the request */
  onApprove: (id: string) => void;

  /** Called when user denies the request */
  onDeny: (id: string) => void;

  /** Loading state during API call */
  isResolving?: boolean;

  /** Additional CSS classes for the overlay */
  class?: string;
}

/**
 * Modal dialog for permission requests
 *
 * @example
 * ```tsx
 * <PermissionDialog
 *   request={permissions.currentRequest()}
 *   onApprove={(id) => permissions.approve(id)}
 *   onDeny={(id) => permissions.deny(id)}
 * />
 * ```
 */
export const PermissionDialog: Component<PermissionDialogProps> = props => {
  return (
    <Show when={props.request}>
      {request => (
        <div
          class={cn(
            "fixed inset-0 z-50",
            "flex items-center justify-center",
            "bg-black/50 backdrop-blur-sm",
            "animate-in fade-in duration-200",
            props.class
          )}
        >
          {/* Dialog card */}
          <div
            class={cn(
              "bg-card border-border border",
              "rounded-xl p-6 shadow-2xl",
              "mx-4 w-full max-w-lg",
              "animate-in zoom-in-95 duration-200"
            )}
          >
            {/* Header */}
            <div class="mb-4 flex items-start gap-3">
              {/* Warning icon */}
              <div class="shrink-0 rounded-full bg-amber-500/10 p-2">
                <svg
                  class="h-6 w-6 text-amber-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>

              <div class="min-w-0">
                <h2 class="text-foreground text-lg font-semibold">Permission Required</h2>
                <p class="text-muted-foreground mt-0.5 text-sm">
                  A tool requires your approval before execution
                </p>
              </div>
            </div>

            {/* Tool info */}
            <div class="mb-6 space-y-3">
              {/* Tool name */}
              <div class="flex items-center gap-2">
                <span class="text-muted-foreground text-sm">Tool:</span>
                <span class="bg-primary/10 text-primary rounded px-2 py-0.5 font-mono text-sm">
                  {request().toolName}
                </span>
              </div>

              {/* Arguments */}
              <Show when={request().args && Object.keys(request().args).length > 0}>
                <div>
                  <span class="text-muted-foreground mb-1.5 block text-sm">Arguments:</span>
                  <pre
                    class={cn(
                      "font-mono text-xs",
                      "rounded-lg p-3",
                      "bg-muted/50 border-border/50 border",
                      "max-h-40 overflow-x-auto"
                    )}
                  >
                    {JSON.stringify(request().args, null, 2)}
                  </pre>
                </div>
              </Show>

              {/* Description */}
              <Show when={request().description}>
                <div class="text-muted-foreground bg-muted/30 rounded-lg p-3 text-sm">
                  {request().description}
                </div>
              </Show>
            </div>

            {/* Actions */}
            <div class="flex items-center justify-end gap-3">
              {/* Deny button */}
              <button
                onClick={() => props.onDeny(request().id)}
                disabled={props.isResolving}
                class={cn(
                  "rounded-lg px-4 py-2",
                  "text-sm font-medium",
                  "bg-destructive/10 text-destructive",
                  "hover:bg-destructive/20",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  "transition-colors duration-150"
                )}
              >
                Deny
              </button>

              {/* Approve button */}
              <button
                onClick={() => props.onApprove(request().id)}
                disabled={props.isResolving}
                class={cn(
                  "rounded-lg px-4 py-2",
                  "text-sm font-medium",
                  "bg-primary text-primary-foreground",
                  "hover:bg-primary/90",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                  "transition-colors duration-150",
                  "flex items-center gap-2"
                )}
              >
                <Show
                  when={!props.isResolving}
                  fallback={
                    <svg class="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle
                        class="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        stroke-width="4"
                      />
                      <path
                        class="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                  }
                >
                  <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" />
                  </svg>
                </Show>
                Allow
              </button>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
};

export default PermissionDialog;
