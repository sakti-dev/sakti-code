import type { StreamRequest } from "@sakti-code/llm";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  type FauxProviderRegistration,
  fauxAssistantMessage,
  registerFauxStreamProvider,
} from "../../__tests__/helpers/faux-provider.ts";
import {
  TEST_BRANCH_SUMMARY_PROMPTS,
  TEST_COMPACTION_PROMPTS,
  TEST_SKILLS_INSTRUCTIONS,
} from "../../__tests__/helpers/test-compaction-prompts.ts";
import { TestExecutionEnv } from "../../agent/__tests__/test-execution-env.ts";
import type { AgentHarness as AgentHarnessType } from "../../agent/agent-harness.ts";
import { AgentHarness } from "../../agent/agent-harness.ts";
import { parseCompactionSettings } from "../../memory/compaction/auto-compaction.ts";
import type { StuckGuardState } from "../../memory/compaction/retry-loop.ts";
import { parseRetrySettings } from "../../memory/compaction/retry-loop.ts";
import type { SessionShape } from "../../session/session.ts";
import { PromiseSession, promiseSessionAsShape } from "../../session/session.ts";
import type { SessionStorageShape } from "../../session/storage.ts";
import { InMemorySessionStorageLive, SessionStorage } from "../../session/storage.ts";
import { type AgentRunDeps, runAgentRunEffect } from "../agent-run.ts";

/**
 * Build an in-memory SessionStorageShape + a PromiseSession-wrapped
 * SessionShape, both backed by the same storage. Mirrors how the server
 * constructs them in runner.ts.
 */
async function makeSession(): Promise<{
  storage: SessionStorageShape;
  sessionShape: SessionShape;
}> {
  const storage = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* SessionStorage;
    }).pipe(Effect.provide(InMemorySessionStorageLive())),
  );
  const sessionInstance = new PromiseSession(storage);
  const sessionShape = promiseSessionAsShape(sessionInstance);
  return { storage, sessionShape };
}

const registrations: FauxProviderRegistration[] = [];

afterEach(() => {
  for (const registration of registrations.splice(0)) {
    registration.setResponses([]);
  }
});

/**
 * Build a harness backed by a single faux assistant message response.
 * Used by every test — the factory's wiring is independent of which message
 * the LLM returns.
 */
async function makeHarnessWithResponse(resources?: {
  skills?: Array<{
    name: string;
    content: string;
    description: string;
    filePath: string;
  }>;
  templates?: Array<{ name: string; content: string }>;
}): Promise<{
  harness: AgentHarnessType;
  sessionShape: SessionShape;
  storage: SessionStorageShape;
}> {
  const registration = registerFauxStreamProvider();
  registrations.push(registration);
  registration.setResponses([(_req: StreamRequest) => fauxAssistantMessage("hi")]);
  const { sessionShape, storage } = await makeSession();
  const harness = new AgentHarness({
    env: new TestExecutionEnv("/tmp"),
    session: sessionShape,
    model: registration.getModel(),
    streamFn: registration.streamFn,
    compactionPrompts: TEST_COMPACTION_PROMPTS,
    branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
    skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
    ...(resources === undefined
      ? {}
      : {
          resources: {
            ...(resources.skills === undefined ? {} : { skills: resources.skills }),
            ...(resources.templates === undefined ? {} : { promptTemplates: resources.templates }),
          },
        }),
  });
  return { harness, sessionShape, storage };
}

interface BaseDepsOverrides {
  emit?: (event: unknown) => void;
  harness: AgentHarnessType;
  loadStuckGuard?: () => Effect.Effect<StuckGuardState, Error>;
  message?: string;
  persistStuckGuard?: () => Effect.Effect<void, Error>;
  registerRun?: AgentRunDeps["registerRun"];
  sessionShape: SessionShape;
  skills?: Array<{
    name: string;
    content: string;
    description: string;
    filePath: string;
  }>;
  storage: SessionStorageShape;
  templates?: Array<{ name: string; content: string }>;
  unregisterRun?: AgentRunDeps["unregisterRun"];
}

/** Minimal deps for the factory — harness built separately by each test. */
function baseDeps(overrides: BaseDepsOverrides) {
  return {
    harness: overrides.harness,
    sessionShape: overrides.sessionShape,
    storage: overrides.storage,
    message: overrides.message ?? "hello",
    retrySettings: parseRetrySettings({ auto_retry: "false" }),
    compactionSettings: parseCompactionSettings({ auto_compaction: "false" }),
    compactionPrompts: TEST_COMPACTION_PROMPTS,
    model: registrations[0]!.getModel(),
    apiKey: "test",
    skills: overrides.skills ?? [],
    templates: overrides.templates ?? [],
    cwd: "/tmp",
    loadStuckGuard:
      overrides.loadStuckGuard ?? (() => Effect.succeed({ consecutiveCompacts: 0, paused: false })),
    persistStuckGuard: overrides.persistStuckGuard ?? (() => Effect.void),
    emit: overrides.emit ?? (() => {}),
    ...(overrides.registerRun === undefined ? {} : { registerRun: overrides.registerRun }),
    ...(overrides.unregisterRun === undefined ? {} : { unregisterRun: overrides.unregisterRun }),
  };
}

describe("runAgentRunEffect", () => {
  it("drains harness events to emit and ends with agent_end", async () => {
    const { harness, sessionShape, storage } = await makeHarnessWithResponse();
    const events: unknown[] = [];

    await Effect.runPromise(
      runAgentRunEffect(
        baseDeps({
          harness,
          sessionShape,
          storage,
          emit: (e) => events.push(e),
        }),
      ),
    );

    expect(events.length).toBeGreaterThan(0);
    expect(events.at(-1)).toMatchObject({ type: "agent_end" });
  });
});

describe("runAgentRunEffect registerRun / unregisterRun hooks", () => {
  it("calls registerRun at start and unregisterRun on exit (success)", async () => {
    const { harness, sessionShape, storage } = await makeHarnessWithResponse();
    const registered = vi.fn(
      (_info: {
        harness: AgentHarnessType;
        retryAbort: AbortController;
        unsubscribe: () => void;
      }) => true,
    );
    const unregistered = vi.fn();

    await Effect.runPromise(
      runAgentRunEffect(
        baseDeps({
          harness,
          sessionShape,
          storage,
          registerRun: registered,
          unregisterRun: unregistered,
        }),
      ),
    );

    expect(registered).toHaveBeenCalledOnce();
    expect(registered.mock.calls[0]?.[0]).toMatchObject({
      harness,
      retryAbort: expect.any(AbortController),
      unsubscribe: expect.any(Function),
    });
    expect(unregistered).toHaveBeenCalledOnce();
  });

  it("fails with busy error when registerRun returns false", async () => {
    const { harness, sessionShape, storage } = await makeHarnessWithResponse();
    const unregistered = vi.fn();

    const promise = Effect.runPromise(
      runAgentRunEffect(
        baseDeps({
          harness,
          sessionShape,
          storage,
          registerRun: () => false,
          unregisterRun: unregistered,
        }),
      ),
    );

    await expect(promise).rejects.toThrow(/already active/);
    // unregisterRun still fires via Effect.ensuring even on the busy-path failure.
    expect(unregistered).toHaveBeenCalledOnce();
  });
});

describe("runAgentRunEffect planFirstTurn dispatch", () => {
  it("plain text → harness.promptEffect", async () => {
    const { harness, sessionShape, storage } = await makeHarnessWithResponse();
    const spy = vi.spyOn(harness, "promptEffect");

    await Effect.runPromise(
      runAgentRunEffect(baseDeps({ harness, sessionShape, storage, message: "hello world" })),
    );

    expect(spy).toHaveBeenCalled();
  });

  it("leading / routes to promptFromTemplateEffect when template exists", async () => {
    const templates = [{ name: "review", content: "do a review" }];
    const { harness, sessionShape, storage } = await makeHarnessWithResponse({
      templates,
    });
    const spy = vi.spyOn(harness, "promptFromTemplateEffect");

    await Effect.runPromise(
      runAgentRunEffect(
        baseDeps({
          harness,
          sessionShape,
          storage,
          message: "/review",
          templates,
        }),
      ),
    );

    expect(spy).toHaveBeenCalledWith("review", []);
  });

  it("leading skill: routes to skillEffect when skill exists", async () => {
    const skills = [
      {
        name: "brainstorm",
        content: "...",
        description: "...",
        filePath: "/tmp/x.md",
      },
    ];
    const { harness, sessionShape, storage } = await makeHarnessWithResponse({
      skills,
    });
    const spy = vi.spyOn(harness, "skillEffect");

    await Effect.runPromise(
      runAgentRunEffect(
        baseDeps({
          harness,
          sessionShape,
          storage,
          message: "skill:brainstorm hello",
          skills,
        }),
      ),
    );

    expect(spy).toHaveBeenCalledWith("brainstorm", "hello");
  });
});

describe("runAgentRunEffect stuck-guard", () => {
  it("loads stuck-guard state at run start via the callback", async () => {
    const { harness, sessionShape, storage } = await makeHarnessWithResponse();
    const loadSpy = vi.fn(
      () =>
        Effect.succeed({
          consecutiveCompacts: 0,
          paused: false,
        }) as Effect.Effect<StuckGuardState, Error>,
    );

    await Effect.runPromise(
      runAgentRunEffect(
        baseDeps({
          harness,
          sessionShape,
          storage,
          loadStuckGuard: loadSpy,
        }),
      ),
    );

    expect(loadSpy).toHaveBeenCalledOnce();
  });
});
