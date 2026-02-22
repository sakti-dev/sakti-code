/**
 * PermissionPart Component
 *
 * Renders permission requests inline in the message timeline.
 * Uses BasicTool for consistent styling with tool parts.
 */

import type { PermissionRequest, PermissionStatus } from "@/core/state/stores/permission-store";
import { cn } from "@/utils";
import type { PartProps } from "@/views/workspace-view/chat-area/parts/part-registry";
import { BasicTool } from "@/views/workspace-view/chat-area/tools/basic-tool";
import { For, Show, type Component } from "solid-js";

/**
 * Permission part data structure
 */
export interface PermissionPartData {
  [key: string]: unknown;
  type: "permission";
  request: PermissionRequest;
}

/**
 * Map permission status to BasicTool status
 */
function mapStatus(status: PermissionStatus): "pending" | "completed" | "error" {
  switch (status) {
    case "approved":
      return "completed";
    case "denied":
      return "error";
    case "pending":
    default:
      return "pending";
  }
}

/**
 * Extract permission request from part data
 */
function getPermissionRequest(part: Record<string, unknown>): PermissionRequest | null {
  if (part.type !== "permission") return null;
  if (part.request && typeof part.request === "object") {
    return part.request as PermissionRequest;
  }

  const id =
    typeof part.permissionId === "string"
      ? part.permissionId
      : typeof part.id === "string"
        ? part.id
        : undefined;
  const toolName = typeof part.toolName === "string" ? part.toolName : undefined;
  const args = typeof part.args === "object" && part.args !== null ? part.args : undefined;
  if (!id || !toolName || !args) return null;

  const rawStatus =
    typeof part.status === "string"
      ? part.status
      : typeof (part.state as { status?: unknown } | undefined)?.status === "string"
        ? (part.state as { status: string }).status
        : "pending";
  const status: PermissionStatus =
    rawStatus === "approved" || rawStatus === "denied" ? rawStatus : "pending";

  return {
    id,
    sessionID: typeof part.sessionID === "string" ? part.sessionID : "",
    messageID: typeof part.messageID === "string" ? part.messageID : "",
    toolName,
    args: args as Record<string, unknown>,
    patterns: Array.isArray(part.patterns)
      ? part.patterns.filter((pattern): pattern is string => typeof pattern === "string")
      : undefined,
    description: typeof part.description === "string" ? part.description : undefined,
    status,
    timestamp: typeof part.timestamp === "number" ? part.timestamp : Date.now(),
    callID: typeof part.callID === "string" ? part.callID : undefined,
  };
}

/**
 * PermissionPart - Renders permission requests inline in the message timeline
 *
 * @example
 * ```tsx
 * <PermissionPart
 *   part={{ type: "permission", request: permissionRequest }}
 * />
 * ```
 */
export const PermissionPart: Component<PartProps> = props => {
  const classes = () => (props as PartProps & { class?: string }).class;
  const request = () => getPermissionRequest(props.part);
  const status = () => request()?.status ?? "pending";
  const isPending = () => status() === "pending";

  // If no valid request, render nothing
  if (!request()) {
    return null;
  }

  return (
    <div
      data-component="permission-part"
      data-status={status()}
      class={cn("permission-part", classes())}
    >
      <BasicTool
        trigger={{
          title: `Permission: ${request()?.toolName}`,
          subtitle: request()?.description,
        }}
        icon="shield"
        status={mapStatus(status())}
        locked={isPending()}
        forceOpen={isPending()}
      >
        <Show when={isPending()}>
          <Show when={(request()?.patterns?.length ?? 0) > 0}>
            <div
              data-slot="permission-patterns"
              class="mb-2 max-h-40 overflow-y-auto rounded border p-2"
            >
              <For each={request()?.patterns ?? []}>
                {pattern => <code class="block break-all text-xs">{pattern}</code>}
              </For>
            </div>
          </Show>

          <div data-slot="permission-pending-info" class="text-muted-foreground text-sm">
            Respond using the approval strip above input
          </div>
        </Show>
        <Show when={!isPending()}>
          <div data-slot="permission-result" class="text-sm">
            {status() === "approved" ? "✓ Approved" : "✗ Denied"}
          </div>
        </Show>
      </BasicTool>
    </div>
  );
};

/**
 * Extended props for testing with callbacks
 */
export interface PermissionPartTestProps extends PartProps {
  /** Callback when user approves */
  onApprove?: (id: string, patterns?: string[]) => void;
  /** Callback when user denies */
  onDeny?: (id: string) => void;
  /** Additional CSS classes */
  class?: string;
}

/**
 * PermissionPartWithCallbacks - Version with callbacks for testing
 */
export const PermissionPartWithCallbacks: Component<PermissionPartTestProps> = props => {
  return (
    <PermissionPart
      {...props}
      onPermissionApprove={(id, patterns) => {
        if (patterns) {
          props.onApprove?.(id, patterns);
        } else {
          props.onApprove?.(id);
        }
        return props.onPermissionApprove?.(id, patterns);
      }}
      onPermissionDeny={id => {
        props.onDeny?.(id);
        return props.onPermissionDeny?.(id);
      }}
    />
  );
};
