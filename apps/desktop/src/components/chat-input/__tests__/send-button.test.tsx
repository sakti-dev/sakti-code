import { fireEvent, render, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vite-plus/test";
import { SendButton } from "../send-button";

describe("SendButton", () => {
  it("shows send icon and calls onSend when not streaming", () => {
    const onSend = vi.fn();
    const onAbort = vi.fn();
    render(() => (
      <SendButton canSend={() => true} isSending={false} onSend={onSend} onAbort={onAbort} />
    ));
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onAbort).not.toHaveBeenCalled();
    expect(btn.getAttribute("aria-label")).toBe("Send");
  });

  it("shows stop icon and calls onAbort when streaming", () => {
    const onSend = vi.fn();
    const onAbort = vi.fn();
    render(() => (
      <SendButton canSend={() => false} isSending={true} onSend={onSend} onAbort={onAbort} />
    ));
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
    expect(btn.getAttribute("aria-label")).toBe("Stop");
  });

  it("is not disabled when streaming (cancel must be clickable)", () => {
    const onAbort = vi.fn();
    render(() => (
      <SendButton canSend={() => false} isSending={true} onSend={vi.fn()} onAbort={onAbort} />
    ));
    const btn = screen.getByRole("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  it("is disabled when not streaming and canSend is false", () => {
    const onSend = vi.fn();
    render(() => (
      <SendButton canSend={() => false} isSending={false} onSend={onSend} onAbort={vi.fn()} />
    ));
    const btn = screen.getByRole("button") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("calls onSend when not streaming and canSend is true", () => {
    const onSend = vi.fn();
    render(() => (
      <SendButton canSend={() => true} isSending={false} onSend={onSend} onAbort={vi.fn()} />
    ));
    fireEvent.click(screen.getByRole("button"));
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});
