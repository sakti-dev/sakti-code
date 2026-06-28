import type { StreamRequest } from "@sakti-code/llm";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import {
  type FauxProviderRegistration,
  fauxAssistantMessage,
  fauxAssistantMessageWithContent,
  fauxToolCall,
  registerFauxStreamProvider,
} from "../../__tests__/helpers/faux-provider";
import { TestExecutionEnv } from "../../agent/__tests__/test-execution-env";
import { AgentHarness } from "../../agent/agent-harness";
import { createTestSession } from "../../session/__tests__/session-test-utils";
import type { AgentTool } from "../../types";
import { captureRequest, measureCacheHit } from "./cache-stability-helpers";

const registrations: FauxProviderRegistration[] = [];

afterEach(() => {
  for (const registration of registrations.splice(0)) {
    registration.setResponses([]);
  }
});

const calculateSchema = Type.Object({ expression: Type.String() });
const calculateTool: AgentTool<typeof calculateSchema> = {
  name: "calculate",
  label: "Calculate",
  description: "Evaluate a math expression",
  parameters: calculateSchema,
  async execute(_id, params) {
    return {
      content: [{ type: "text", text: `result: ${params.expression}` }],
      details: { expression: params.expression },
    };
  },
};

describe("cache-stability: prefix stable across turns", () => {
  it("system prompt + tools + message prefix is byte-identical across a multi-turn tool loop", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    const captures: StreamRequest[] = [];

    registration.setResponses([
      () =>
        fauxAssistantMessageWithContent(
          [fauxToolCall("calculate", { expression: "1+1" }, { id: "c1" })],
          "toolUse"
        ),
      () => fauxAssistantMessage("done"),
    ]);

    const harness = new AgentHarness({
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: (req) => {
        captures.push(req);
        return registration.streamFn(req);
      },
      systemPrompt: "frozen prompt — must not change between turns",
      tools: [calculateTool],
    });

    await harness.prompt("compute 1+1");

    expect(captures.length).toBeGreaterThanOrEqual(2);

    for (let i = 1; i < captures.length; i++) {
      const prev = captureRequest(captures[i - 1]!);
      const cur = captureRequest(captures[i]!);
      const result = measureCacheHit(prev, cur);
      expect(
        result.prefixStable,
        `prefix broke at request ${i}: ${result.breakReason}`
      ).toBe(true);
    }
  });
});
