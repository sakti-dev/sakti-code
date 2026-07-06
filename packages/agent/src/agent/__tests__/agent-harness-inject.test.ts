import type { StreamRequest } from "@sakti-code/llm";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  type FauxProviderRegistration,
  fauxAssistantMessage,
  registerFauxStreamProvider,
} from "../../__tests__/helpers/faux-provider";
import {
  TEST_BRANCH_SUMMARY_PROMPTS,
  TEST_SKILLS_INSTRUCTIONS,
} from "../../__tests__/helpers/test-prompt-bundles.ts";
import { TestExecutionEnv } from "../../agent/__tests__/test-execution-env";
import { AgentHarness } from "../../agent/agent-harness";
import type { AgentMessage } from "../../types";
import { createTestSession } from "../../session/__tests__/session-test-utils";

const registrations: FauxProviderRegistration[] = [];

afterEach(() => {
  for (const registration of registrations.splice(0)) {
    registration.setResponses([]);
  }
});

/** Build a minimal synthetic assistant+toolResult pair (simulates skill injection). */
function syntheticPair(): AgentMessage[] {
  const now = Date.now();
  return [
    {
      api: "synthetic",
      content: [
        {
          type: "toolCall",
          id: "skill-read:test",
          name: "read",
          arguments: { filePath: "/skill/SKILL.md" },
        },
      ],
      model: "synthetic",
      provider: "synthetic",
      role: "assistant",
      stopReason: "toolUse",
      timestamp: now,
      usage: {
        cacheRead: 0,
        cacheWrite: 0,
        cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
        input: 0,
        output: 0,
        totalTokens: 0,
      },
    },
    {
      content: [{ type: "text", text: "INJECTED_SKILL_CONTENT" }],
      isError: false,
      role: "toolResult",
      timestamp: now + 1,
      toolCallId: "skill-read:test",
      toolName: "read",
    },
  ];
}

/** Flatten all text content from LLM-format messages for assertion. */
function allText(req: StreamRequest): string {
  return req.messages
    .flatMap((m) => {
      if (typeof m.content === "string") return [m.content];
      if (!Array.isArray(m.content)) return [];
      return m.content.flatMap((part) =>
        part && typeof part === "object" && "text" in part && typeof part.text === "string"
          ? [part.text]
          : [],
      );
    })
    .join(" ");
}

describe("AgentHarness.injectMessages", () => {
  it("prepends injected messages before the user message", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    let capturedReq: StreamRequest | undefined;
    registration.setResponses([
      (req) => {
        capturedReq = req;
        return fauxAssistantMessage("ok");
      },
    ]);
    const harness = new AgentHarness({
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
    });

    harness.injectMessages(syntheticPair());
    await Effect.runPromise(harness.promptEffect("hello"));

    expect(capturedReq).toBeDefined();
    expect(allText(capturedReq!)).toContain("INJECTED_SKILL_CONTENT");
    expect(allText(capturedReq!)).toContain("hello");
  });

  it("is a no-op when messages array is empty", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    let capturedReq: StreamRequest | undefined;
    registration.setResponses([
      (req) => {
        capturedReq = req;
        return fauxAssistantMessage("ok");
      },
    ]);
    const harness = new AgentHarness({
      branchSummaryPrompts: TEST_BRANCH_SUMMARY_PROMPTS,
      skillsInstructions: TEST_SKILLS_INSTRUCTIONS,
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: registration.streamFn,
    });

    harness.injectMessages([]);
    await Effect.runPromise(harness.promptEffect("hello"));

    expect(capturedReq).toBeDefined();
    expect(allText(capturedReq!)).toContain("hello");
    expect(allText(capturedReq!)).not.toContain("INJECTED_SKILL_CONTENT");
  });
});
