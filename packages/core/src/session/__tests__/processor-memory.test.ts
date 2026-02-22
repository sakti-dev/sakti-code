/**
 * Tests for AgentProcessor memory integration.
 *
 * Verifies MemoryProcessor input/output wiring in the run loop.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const memoryInputMock = vi.fn();
const memoryOutputMock = vi.fn();
const memoryFormatMock = vi.fn();
const injectSpecContextMock = vi.fn();
const processInputStepMock = vi.fn();
const listMessagesMock = vi.fn();

type TestableProcessor = {
  streamIteration: (...args: unknown[]) => Promise<unknown>;
  processStream: (...args: unknown[]) => Promise<{ finished: boolean }>;
  messages: Array<{ role: "assistant" | "user" | "system"; content: string }>;
};

vi.mock("ai", () => ({
  streamText: vi.fn(),
  tool: vi.fn(definition => definition),
}));

vi.mock("@/memory", () => ({
  SimpleTokenCounter: class MockTokenCounter {},
  createObserverAgent: vi.fn(() => vi.fn()),
  formatObservationsForInjection: vi.fn(() => ""),
  getAgentMode: vi.fn(() => "default"),
  getMemoryConfig: vi.fn(() => ({})),
  memoryProcessor: {
    input: memoryInputMock,
    output: memoryOutputMock,
    formatForAgentInput: memoryFormatMock,
  },
  messageStorage: {
    listMessages: listMessagesMock,
  },
  processInputStep: processInputStepMock,
}));

vi.mock("@/agent/spec-injector", () => ({
  injectSpecContextForModelMessages: injectSpecContextMock,
}));

vi.mock("@/agent/workflow/model-provider", () => ({
  getBuildModel: vi.fn(() => ({ model: "mock-build" })),
  getExploreModel: vi.fn(() => ({ model: "mock-explore" })),
  getPlanModel: vi.fn(() => ({ model: "mock-plan" })),
  getModelByReference: vi.fn(() => ({ model: "mock-ref" })),
}));

describe("session/processor memory integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    memoryInputMock.mockResolvedValue({
      originalMessage: "Implement auth",
      workingMemory: "## Project Context\n- Runtime: Node",
      recentMessages: [],
    });

    memoryFormatMock.mockReturnValue([
      { role: "system", content: "You are a test agent" },
      { role: "user", content: "Implement auth" },
    ]);

    memoryOutputMock.mockResolvedValue({
      success: true,
      messagesPersisted: 2,
    });
    injectSpecContextMock.mockImplementation(async messages => messages);
    listMessagesMock.mockResolvedValue([]);
    processInputStepMock.mockResolvedValue({ record: { active_observations: "" } });
  });

  it("uses memory input processor when thread context is present", async () => {
    const { AgentProcessor } = await import("@/session/processor");

    const processor = new AgentProcessor(
      {
        id: "test-agent-memory-input",
        type: "build",
        model: "test-model",
        systemPrompt: "You are a test agent",
        tools: {},
        maxIterations: 2,
      },
      () => {}
    );

    const p = processor as unknown as TestableProcessor;
    p.streamIteration = vi.fn(async () => ({}));
    p.processStream = vi.fn(async () => {
      p.messages.push({ role: "assistant", content: "Implemented auth" });
      return { finished: true };
    });

    const result = await processor.run({
      task: "Implement auth",
      context: {
        sessionId: "session-memory-1",
        resourceId: "local",
      },
    });

    expect(result.status).toBe("completed");
    expect(memoryInputMock).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "session-memory-1",
        resourceId: "local",
      })
    );
    expect(memoryFormatMock).toHaveBeenCalled();
  });

  it("persists final user/assistant messages through memory output processor", async () => {
    const { AgentProcessor } = await import("@/session/processor");

    const processor = new AgentProcessor(
      {
        id: "test-agent-memory-output",
        type: "build",
        model: "test-model",
        systemPrompt: "You are a test agent",
        tools: {},
        maxIterations: 2,
      },
      () => {}
    );

    const p = processor as unknown as TestableProcessor;
    p.streamIteration = vi.fn(async () => ({}));
    p.processStream = vi.fn(async () => {
      p.messages.push({ role: "assistant", content: "Fix complete" });
      return { finished: true };
    });

    const result = await processor.run({
      task: "Fix failing tests",
      context: {
        sessionId: "session-memory-2",
        resourceId: "local",
      },
    });

    expect(result.status).toBe("completed");
    expect(memoryOutputMock).toHaveBeenCalledWith({
      threadId: "session-memory-2",
      resourceId: "local",
      messages: [
        { role: "user", content: "Fix failing tests" },
        { role: "assistant", content: "Fix complete" },
      ],
    });
  });

  it("injects spec context into model messages when thread context is present", async () => {
    const { AgentProcessor } = await import("@/session/processor");

    const processor = new AgentProcessor(
      {
        id: "test-agent-spec-injector",
        type: "build",
        model: "test-model",
        systemPrompt: "You are a test agent",
        tools: {},
        maxIterations: 2,
      },
      () => {}
    );

    const p = processor as unknown as TestableProcessor;
    p.streamIteration = vi.fn(async () => ({}));
    p.processStream = vi.fn(async () => ({ finished: true }));

    const result = await processor.run({
      task: "Implement task from spec",
      context: {
        sessionId: "session-memory-3",
        resourceId: "local",
      },
    });

    expect(result.status).toBe("completed");
    expect(injectSpecContextMock).toHaveBeenCalledWith(expect.any(Array), "session-memory-3");
  });

  it("passes reflector model into processInputStep for reflection integration", async () => {
    const { AgentProcessor } = await import("@/session/processor");

    const processor = new AgentProcessor(
      {
        id: "test-agent-reflector-model",
        type: "build",
        model: "test-model",
        systemPrompt: "You are a test agent",
        tools: {},
        maxIterations: 2,
      },
      () => {}
    );

    const p = processor as unknown as TestableProcessor;
    p.streamIteration = vi.fn(async () => ({}));
    p.processStream = vi.fn(async () => ({ finished: true }));

    const result = await processor.run({
      task: "Summarize memory",
      context: {
        sessionId: "session-memory-4",
        resourceId: "local",
      },
    });

    expect(result.status).toBe("completed");
    expect(processInputStepMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reflectorModel: expect.any(Object),
      })
    );
  });

  it("supports resource-scope observation integration when memoryScope is resource", async () => {
    const { AgentProcessor } = await import("@/session/processor");

    const processor = new AgentProcessor(
      {
        id: "test-agent-resource-scope",
        type: "build",
        model: "test-model",
        systemPrompt: "You are a test agent",
        tools: {},
        maxIterations: 2,
      },
      () => {}
    );

    const p = processor as unknown as TestableProcessor;
    p.streamIteration = vi.fn(async () => ({}));
    p.processStream = vi.fn(async () => ({ finished: true }));

    const result = await processor.run({
      task: "Use project-level memory",
      context: {
        sessionId: "session-memory-5",
        resourceId: "resource-abc",
        memoryScope: "resource",
      },
    });

    expect(result.status).toBe("completed");
    expect(listMessagesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: "resource-abc",
        limit: 50,
      })
    );
    expect(processInputStepMock).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({
          scope: "resource",
          resourceId: "resource-abc",
        }),
      })
    );
  });

  it("does not reorder result messages when deriving final assistant content", async () => {
    const { AgentProcessor } = await import("@/session/processor");

    const processor = new AgentProcessor(
      {
        id: "test-agent-message-order",
        type: "build",
        model: "test-model",
        systemPrompt: "You are a test agent",
        tools: {},
        maxIterations: 2,
      },
      () => {}
    );

    memoryFormatMock.mockReturnValue([
      { role: "system", content: "You are a test agent" },
      { role: "user", content: "Keep order stable" },
    ]);

    const p = processor as unknown as TestableProcessor;
    p.streamIteration = vi.fn(async () => ({}));
    p.processStream = vi.fn(async () => {
      p.messages.push({ role: "assistant", content: "Final answer" });
      return { finished: true };
    });

    const result = await processor.run({
      task: "Keep order stable",
      context: {
        sessionId: "session-memory-6",
        resourceId: "local",
      },
    });

    expect(result.status).toBe("completed");
    expect(result.finalContent).toBe("Final answer");
    expect(result.messages.map(message => message.role)).toEqual(["system", "user", "assistant"]);
  });
});
