/**
 * Tests for AgentProcessor memory integration.
 *
 * Verifies MemoryProcessor input/output wiring in the run loop.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const memoryInputMock = vi.fn();
const memoryOutputMock = vi.fn();
const memoryFormatMock = vi.fn();

type TestableProcessor = {
  streamIteration: (...args: unknown[]) => Promise<unknown>;
  processStream: (...args: unknown[]) => Promise<{ finished: boolean }>;
  messages: Array<{ role: "assistant" | "user" | "system"; content: string }>;
};

vi.mock("ai", () => ({
  streamText: vi.fn(),
}));

vi.mock("../../src/memory/processors", () => ({
  memoryProcessor: {
    input: memoryInputMock,
    output: memoryOutputMock,
    formatForAgentInput: memoryFormatMock,
  },
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
  });

  it("uses memory input processor when thread context is present", async () => {
    const { AgentProcessor } = await import("../../src/session/processor");

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
    const { AgentProcessor } = await import("../../src/session/processor");

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
});
