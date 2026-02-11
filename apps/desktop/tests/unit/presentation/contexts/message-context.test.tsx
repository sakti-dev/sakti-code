import { MessageProvider, useMessage } from "@ekacode/desktop/presentation/contexts";
import {
  StoreProvider,
  useMessageStore,
  usePartStore,
  useSessionStore,
} from "@renderer/presentation/providers/store-provider";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let messageContext: ReturnType<typeof useMessage> | null = null;
let messageActions: ReturnType<typeof useMessageStore>[1] | null = null;
let partActions: ReturnType<typeof usePartStore>[1] | null = null;
let sessionActions: ReturnType<typeof useSessionStore>[1] | null = null;
let cleanup: (() => void) | null = null;

function mountProviders() {
  const container = document.createElement("div");
  document.body.appendChild(container);

  const dispose = render(
    () => (
      <StoreProvider>
        <MessageProvider>
          <Probe />
        </MessageProvider>
      </StoreProvider>
    ),
    container
  );

  cleanup = () => {
    dispose();
    container.remove();
  };
}

function Probe() {
  messageContext = useMessage();
  messageActions = useMessageStore()[1];
  partActions = usePartStore()[1];
  sessionActions = useSessionStore()[1];
  return null;
}

beforeEach(() => {
  messageContext = null;
  messageActions = null;
  partActions = null;
  sessionActions = null;
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
  mountProviders();
  sessionActions!.upsert({ sessionID: "s1", directory: "/tmp/test" });
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("MessageContext", () => {
  it("computes status from message time metadata", () => {
    messageActions!.upsert({
      id: "m-pending",
      role: "assistant",
      sessionID: "s1",
      time: { created: Date.now() - 60_000 },
    } as { id: string; role: string; sessionID: string; time: { created: number } });
    messageActions!.upsert({
      id: "m-complete",
      role: "assistant",
      sessionID: "s1",
      time: { created: Date.now() - 1_000, completed: Date.now() },
    } as {
      id: string;
      role: string;
      sessionID: string;
      time: { created: number; completed: number };
    });

    expect(messageContext!.getStatus("does-not-exist")).toBe("unknown");
    expect(messageContext!.getStatus("m-pending")).toBe("pending");
    expect(messageContext!.getStatus("m-complete")).toBe("complete");
  });

  it("extracts and copies message text from text parts", async () => {
    messageActions!.upsert({
      id: "m1",
      role: "user",
      sessionID: "s1",
      time: { created: Date.now() },
    } as { id: string; role: string; sessionID: string; time: { created: number } });
    partActions!.upsert({
      id: "p1",
      type: "text",
      messageID: "m1",
      sessionID: "s1",
      text: "hello ",
    } as { id: string; type: string; messageID: string; sessionID: string; text: string });
    partActions!.upsert({
      id: "p2",
      type: "text",
      messageID: "m1",
      sessionID: "s1",
      content: { text: "world" },
    } as {
      id: string;
      type: string;
      messageID: string;
      sessionID: string;
      content: { text: string };
    });

    expect(messageContext!.getText("m1")).toBe("hello world");
    await messageContext!.copy("m1");
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("hello world");
  });

  it("deletes message entries from store", () => {
    messageActions!.upsert({
      id: "m-delete",
      role: "user",
      sessionID: "s1",
      time: { created: Date.now() },
    } as { id: string; role: string; sessionID: string; time: { created: number } });
    expect(messageContext!.getMessage("m-delete")).toBeDefined();
    messageContext!.delete("m-delete");
    expect(messageContext!.getMessage("m-delete")).toBeUndefined();
  });
});
