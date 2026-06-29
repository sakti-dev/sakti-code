import { describe, expect, it } from "vitest";
import {
  type FauxProviderRegistration,
  fauxAssistantMessage,
  registerFauxStreamProvider,
} from "../../__tests__/helpers/faux-provider";
import { TEST_COMPACTION_PROMPTS } from "../../__tests__/helpers/test-compaction-prompts.ts";
import { AgentHarness } from "../../agent/agent-harness";
import { createTestSession } from "../../session/__tests__/session-test-utils";
import type { SessionShape } from "../../session/session";
import { TestExecutionEnv } from "./test-execution-env.ts";

/**
 * A deferred promise used to block a faux stream response until we resolve it,
 * so we can hold a harness in a non-idle phase while we assert on it.
 */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

/** Build a harness backed by a faux stream provider. */
async function makeHarness(
  registration: FauxProviderRegistration,
  session?: SessionShape
): Promise<AgentHarness> {
  return new AgentHarness({
    env: new TestExecutionEnv(process.cwd()),
    session: session ?? (await createTestSession()),
    model: registration.getModel(),
    streamFn: registration.streamFn,
    steeringMode: "all",
    followUpMode: "all",
    compactionPrompts: TEST_COMPACTION_PROMPTS,
  });
}

/** Collect emitted event types into an array for assertions.
 * Typed structurally so it accepts the harness's wide `AgentHarnessEvent`
 * union without needing the harness's generic skill/template parameters. */
function collectEventTypes(harness: AgentHarness): string[] {
  const types: string[] = [];
  harness.subscribe((event) => {
    types.push(event.type);
  });
  return types;
}

describe("AgentHarness.continue()", () => {
  it("re-runs the agent loop from current session state and returns the new assistant message", async () => {
    // Two successful responses: first for prompt(), second for continue().
    const registration = registerFauxStreamProvider();
    registration.setResponses([
      () => fauxAssistantMessage("first response"),
      () => fauxAssistantMessage("continued response"),
    ]);
    const harness = await makeHarness(registration);
    const eventTypes = collectEventTypes(harness);

    // 1. Initial prompt produces the first assistant message.
    const first = await harness.prompt("hello");
    expect(first.content).toEqual([{ type: "text", text: "first response" }]);

    // 2. Simulate the retry scenario: append a user message so the transcript
    //    ends with a non-assistant message (continue() requires this).
    //    In production, the server rolls the session leaf back past the failed
    //    assistant message; appending a fresh user message exercises the same
    //    "continue from non-assistant tail" path.
    await harness.appendMessage({
      content: "again please",
      role: "user",
      timestamp: Date.now(),
    });

    // 3. continue() must re-enter the loop and return the new assistant message.
    const continued = await harness.continue();
    expect(continued.content).toEqual([
      { type: "text", text: "continued response" },
    ]);

    // 4. The faux provider should have been called twice total.
    expect(registration.callCount).toBe(2);

    // 5. The continue run emitted its own agent_start/agent_end pair (after the
    //    prompt's). Counting agent_start events is a robust way to assert the
    //    loop actually re-ran.
    const agentStartCount = eventTypes.filter(
      (t) => t === "agent_start"
    ).length;
    expect(agentStartCount).toBe(2);
  });

  it("throws if called while the harness is busy", async () => {
    const registration = registerFauxStreamProvider();
    const gate = deferred();
    // First response blocks on the gate so prompt() stays in the "turn" phase.
    registration.setResponses([
      async () => {
        await gate.promise;
        return fauxAssistantMessage("done");
      },
    ]);
    const harness = await makeHarness(registration);

    // Start prompt but do NOT await — phase is set to "turn" synchronously.
    const promptPromise = harness.prompt("hello");

    // continue() must reject because the harness is not idle.
    await expect(harness.continue()).rejects.toThrow(/busy/i);

    // Release the gate and let the prompt finish so the harness settles.
    gate.resolve();
    await promptPromise;
  });

  it("throws if the session has no messages", async () => {
    const registration = registerFauxStreamProvider();
    registration.setResponses([() => fauxAssistantMessage("ok")]);
    const harness = await makeHarness(registration);

    // Empty session → nothing to continue from.
    await expect(harness.continue()).rejects.toThrow(/no messages/i);
  });

  it("throws if the last message is an assistant message", async () => {
    const registration = registerFauxStreamProvider();
    registration.setResponses([() => fauxAssistantMessage("ok")]);
    const harness = await makeHarness(registration);

    // prompt() leaves the transcript ending in an assistant message.
    await harness.prompt("hello");

    // Without appending a user/toolResult message, continue() must refuse —
    // re-running from an assistant tail would send an invalid transcript.
    await expect(harness.continue()).rejects.toThrow(/assistant/i);
  });
});
