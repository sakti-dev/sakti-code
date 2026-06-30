import type { PermissionReply } from "@sakti-code/agent";
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vite-plus/test";
import type { PermissionPending } from "~/stores/session/session-store";
import { PermissionStrip } from "../permission-strip.tsx";

const ALLOW_RE = /Allow read/;
const PATTERNS_RE = /secret\.env/;

function makeRequest(overrides: Partial<PermissionPending> = {}): PermissionPending {
  return {
    id: "per_1",
    permission: "read",
    patterns: ["secret.env"],
    toolName: "read",
    toolCallId: "c1",
    ...overrides,
  };
}

describe("PermissionStrip", () => {
  it("renders the tool name, permission and patterns", () => {
    render(() => <PermissionStrip onReply={vi.fn()} request={makeRequest()} />);
    expect(screen.getByText(ALLOW_RE)).toBeTruthy();
    expect(screen.getByText(PATTERNS_RE)).toBeTruthy();
  });

  it.each<[string, PermissionReply]>([
    ["Allow", "once"],
    ["Always", "always"],
    ["Deny", "reject"],
  ])("sends %s -> %s on click", async (label, reply) => {
    const onReply = vi.fn();
    render(() => <PermissionStrip onReply={onReply} request={makeRequest()} />);
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(onReply).toHaveBeenCalledWith(reply);
  });
});
