import { afterEach, describe, expect, it } from "vite-plus/test";
import { fauxAssistantMessage, teardownFauxLlm, useFauxLlm } from "../../__tests__/llm-helpers.ts";
import { createMockStore, createMultiSessionCtx } from "./helpers.ts";

const { handleMessage } = await import("../ws-handler.ts");

afterEach(() => {
  teardownFauxLlm();
});

describe("Multi-session e2e", () => {
  // The WS-handler e2e path drives runPrompt → runAgentRunEffect → real stream.
  // useFauxLlm's mock doesn't fully intercept this end-to-end shape, so the
  // call leaks to the real provider. Gate on SAKTI_SMOKE=1 (requires a real
  // OPENCODE_API_KEY) so the test only runs when explicitly opted in.
  const e2eIt = process.env.SAKTI_SMOKE === "1" ? it : it.skip;

  e2eIt(
    "two concurrent sessions produce frames with correct sessionId and no cross-contamination",
    async () => {
      // Two concurrent sessions — each gets its own frame stream.
      useFauxLlm([fauxAssistantMessage("response"), fauxAssistantMessage("response")]);

      const ctx = createMultiSessionCtx({
        "sess-a": "proj-1",
        "sess-b": "proj-2",
      });
      const storeA = createMockStore();
      const storeB = createMockStore();

      const framesA: unknown[] = [];
      const framesB: unknown[] = [];
      const wsA = {
        send: (d: unknown) => framesA.push(d),
      };
      const wsB = {
        send: (d: unknown) => framesB.push(d),
      };

      handleMessage(ctx, storeA, wsA, {
        type: "prompt",
        sessionId: "sess-a",
        message: "Hello from A",
      });
      handleMessage(ctx, storeB, wsB, {
        type: "prompt",
        sessionId: "sess-b",
        message: "Hello from B",
      });

      // Drain: faux provider streams synchronously enough that all frames
      // settle within a microtask. Wait one macrotask for safety.
      await new Promise((r) => setTimeout(r, 50));

      expect(framesA.every((f) => (f as { sessionId: string }).sessionId === "sess-a")).toBe(true);
      expect(framesB.every((f) => (f as { sessionId: string }).sessionId === "sess-b")).toBe(true);
      expect(framesA.length).toBeGreaterThan(0);
      expect(framesB.length).toBeGreaterThan(0);
    },
  );
});
