import {
  PermissionPartWithCallbacks,
  type PermissionPartData,
} from "@/views/workspace-view/chat-area/parts/permission-part";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createApprovedPermissionRequest,
  createCanonicalPermissionPart,
  createDeniedPermissionRequest,
  createPendingPermissionRequest,
} from "../../../../../fixtures/permission-question-fixtures";

/**
 * Create a permission part data object for testing
 */
function createPermissionPartData(
  request: ReturnType<typeof createPendingPermissionRequest>
): PermissionPartData {
  return {
    type: "permission",
    request,
  };
}

describe("PermissionPart", () => {
  let container: HTMLDivElement;
  let dispose: () => void;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    dispose?.();
    document.body.removeChild(container);
  });

  it("renders tool name in trigger", () => {
    const request = createPendingPermissionRequest({ toolName: "bash" });
    const part = createPermissionPartData(request);

    dispose = render(() => <PermissionPartWithCallbacks part={part} />, container);

    expect(container.textContent).toContain("Permission: bash");
  });

  it("renders description as subtitle", () => {
    const request = createPendingPermissionRequest({
      description: "Run build command",
    });
    const part = createPermissionPartData(request);

    dispose = render(() => <PermissionPartWithCallbacks part={part} />, container);

    expect(container.textContent).toContain("Run build command");
  });

  it("shows pending status with locked state", () => {
    const request = createPendingPermissionRequest();
    const part = createPermissionPartData(request);

    dispose = render(() => <PermissionPartWithCallbacks part={part} />, container);

    const permPart = container.querySelector('[data-component="permission-part"]');
    expect(permPart?.getAttribute("data-status")).toBe("pending");

    const basicTool = container.querySelector('[data-component="basic-tool"]');
    expect(basicTool?.getAttribute("data-status")).toBe("pending");
  });

  it("shows Approve and Deny buttons when pending", () => {
    const request = createPendingPermissionRequest();
    const part = createPermissionPartData(request);

    dispose = render(() => <PermissionPartWithCallbacks part={part} />, container);

    const approveBtn = container.querySelector('[data-action="approve-once"]');
    const approveAlwaysBtn = container.querySelector('[data-action="approve-always"]');
    const denyBtn = container.querySelector('[data-action="deny"]');

    expect(approveBtn).not.toBeNull();
    expect(approveAlwaysBtn).not.toBeNull();
    expect(denyBtn).not.toBeNull();
  });

  it("calls onApprove with id when approve clicked", () => {
    const request = createPendingPermissionRequest({ id: "perm-123" });
    const part = createPermissionPartData(request);
    const onApprove = vi.fn();

    dispose = render(
      () => <PermissionPartWithCallbacks part={part} onApprove={onApprove} />,
      container
    );

    const approveBtn = container.querySelector('[data-action="approve-once"]') as HTMLButtonElement;
    approveBtn.click();

    expect(onApprove).toHaveBeenCalledWith("perm-123");
  });

  it("calls onApprove with patterns when allow always clicked", () => {
    const request = createPendingPermissionRequest({
      id: "perm-allow-always",
      patterns: ["src/**", "packages/**"],
    });
    const part = createPermissionPartData(request);
    const onApprove = vi.fn();

    dispose = render(
      () => <PermissionPartWithCallbacks part={part} onApprove={onApprove} />,
      container
    );

    const approveBtn = container.querySelector(
      '[data-action="approve-always"]'
    ) as HTMLButtonElement;
    approveBtn.click();

    expect(onApprove).toHaveBeenCalledWith("perm-allow-always", ["src/**", "packages/**"]);
  });

  it("calls onDeny with id when deny clicked", () => {
    const request = createPendingPermissionRequest({ id: "perm-456" });
    const part = createPermissionPartData(request);
    const onDeny = vi.fn();

    dispose = render(() => <PermissionPartWithCallbacks part={part} onDeny={onDeny} />, container);

    const denyBtn = container.querySelector('[data-action="deny"]') as HTMLButtonElement;
    denyBtn.click();

    expect(onDeny).toHaveBeenCalledWith("perm-456");
  });

  it("shows approved status with checkmark text", () => {
    const request = createApprovedPermissionRequest();
    const part = createPermissionPartData(request);

    dispose = render(
      () => <PermissionPartWithCallbacks part={part} defaultOpen={true} />,
      container
    );

    const permPart = container.querySelector('[data-component="permission-part"]');
    expect(permPart?.getAttribute("data-status")).toBe("approved");

    // Status mapping is correct (completed = approved)
    const basicTool = container.querySelector('[data-component="basic-tool"]');
    expect(basicTool?.getAttribute("data-status")).toBe("completed");
  });

  it("shows denied status with X text", () => {
    const request = createDeniedPermissionRequest();
    const part = createPermissionPartData(request);

    dispose = render(
      () => <PermissionPartWithCallbacks part={part} defaultOpen={true} />,
      container
    );

    const permPart = container.querySelector('[data-component="permission-part"]');
    expect(permPart?.getAttribute("data-status")).toBe("denied");

    // Status mapping is correct (error = denied)
    const basicTool = container.querySelector('[data-component="basic-tool"]');
    expect(basicTool?.getAttribute("data-status")).toBe("error");
  });

  it("does not show buttons when not pending", () => {
    const request = createApprovedPermissionRequest();
    const part = createPermissionPartData(request);

    dispose = render(() => <PermissionPartWithCallbacks part={part} />, container);

    const actions = container.querySelector('[data-slot="permission-actions"]');
    expect(actions).toBeNull();
  });

  it("applies data-component attribute", () => {
    const request = createPendingPermissionRequest();
    const part = createPermissionPartData(request);

    dispose = render(() => <PermissionPartWithCallbacks part={part} />, container);

    const permPart = container.querySelector('[data-component="permission-part"]');
    expect(permPart).not.toBeNull();
  });

  it("applies data-status attribute correctly", () => {
    const request = createDeniedPermissionRequest();
    const part = createPermissionPartData(request);

    dispose = render(() => <PermissionPartWithCallbacks part={part} />, container);

    const permPart = container.querySelector('[data-component="permission-part"]');
    expect(permPart?.getAttribute("data-status")).toBe("denied");
  });

  it("applies custom class", () => {
    const request = createPendingPermissionRequest();
    const part = createPermissionPartData(request);

    dispose = render(
      () => <PermissionPartWithCallbacks part={part} class="custom-permission" />,
      container
    );

    const permPart = container.querySelector('[data-component="permission-part"]');
    expect(permPart?.classList.contains("custom-permission")).toBe(true);
  });

  it("maps approved status to completed for BasicTool", () => {
    const request = createApprovedPermissionRequest();
    const part = createPermissionPartData(request);

    dispose = render(() => <PermissionPartWithCallbacks part={part} />, container);

    const basicTool = container.querySelector('[data-component="basic-tool"]');
    expect(basicTool?.getAttribute("data-status")).toBe("completed");
  });

  it("maps denied status to error for BasicTool", () => {
    const request = createDeniedPermissionRequest();
    const part = createPermissionPartData(request);

    dispose = render(() => <PermissionPartWithCallbacks part={part} />, container);

    const basicTool = container.querySelector('[data-component="basic-tool"]');
    expect(basicTool?.getAttribute("data-status")).toBe("error");
  });

  it("returns null for invalid part type", () => {
    const invalidPart = { type: "invalid" };

    dispose = render(() => <PermissionPartWithCallbacks part={invalidPart} />, container);

    const permPart = container.querySelector('[data-component="permission-part"]');
    expect(permPart).toBeNull();
  });

  it("renders canonical flat permission part shape", () => {
    const request = createPendingPermissionRequest({
      id: "perm-flat-1",
      messageID: "msg-1",
      sessionID: "session-1",
      toolName: "bash",
      args: { command: "npm run build" },
      description: "Need shell access",
    });
    const canonicalPart = createCanonicalPermissionPart(request, { id: "part-1" });

    dispose = render(() => <PermissionPartWithCallbacks part={canonicalPart} />, container);

    expect(container.textContent).toContain("Permission: bash");
    expect(container.querySelector('[data-action="approve-once"]')).not.toBeNull();
  });
});
