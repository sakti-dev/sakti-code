import { SessionProvider, useSession } from "@/core/state/contexts";
import { StoreProvider, useSessionStore } from "@/core/state/providers/store-provider";
import { render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let sessionContext: ReturnType<typeof useSession> | null = null;
let sessionActions: ReturnType<typeof useSessionStore>[1] | null = null;
let cleanup: (() => void) | null = null;

function Probe() {
  sessionContext = useSession();
  sessionActions = useSessionStore()[1];
  return null;
}

function mountProviders() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const { unmount: dispose } = render(() => (
    <StoreProvider>
      <SessionProvider>
        <Probe />
      </SessionProvider>
    </StoreProvider>
  ));
  cleanup = () => {
    dispose();
    container.remove();
  };
}

beforeEach(() => {
  sessionContext = null;
  sessionActions = null;
  mountProviders();
});

afterEach(() => {
  cleanup?.();
  cleanup = null;
  document.body.innerHTML = "";
});

describe("SessionContext", () => {
  it("reads sessions by directory and id", () => {
    sessionActions!.upsert({ sessionID: "s1", directory: "/repo" });
    sessionActions!.upsert({ sessionID: "s2", directory: "/repo" });
    sessionActions!.upsert({ sessionID: "s3", directory: "/other" });

    expect(sessionContext!.getByDirectory("/repo").map(s => s.sessionID)).toEqual(["s1", "s2"]);
    expect(sessionContext!.getById("s3")).toEqual({ sessionID: "s3", directory: "/other" });
  });

  it("tracks active sessions from status", () => {
    sessionActions!.upsert({ sessionID: "s1", directory: "/repo" });
    sessionActions!.upsert({ sessionID: "s2", directory: "/repo" });
    sessionContext!.setStatus("s1", { type: "busy" });
    sessionContext!.setStatus("s2", { type: "idle" });

    expect(sessionContext!.getStatus("s1")).toEqual({ type: "busy" });
    expect(sessionContext!.getActiveSessions("/repo").map(s => s.sessionID)).toEqual(["s1"]);
  });
});
