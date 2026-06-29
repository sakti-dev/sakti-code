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
import { TEST_COMPACTION_PROMPTS } from "../../__tests__/helpers/test-compaction-prompts.ts";
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

const echoSchema = Type.Object({ text: Type.String() });
function makeEchoTool(name: string): AgentTool<typeof echoSchema> {
  return {
    name,
    label: name,
    description: `echo tool ${name}`,
    parameters: echoSchema,
    async execute(_id, _params) {
      return { content: [{ type: "text", text: name }], details: {} };
    },
  };
}

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
      compactionPrompts: TEST_COMPACTION_PROMPTS,
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

  it("hit rate climbs past 90% as history grows across prompts (no compaction)", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    const captures: StreamRequest[] = [];

    const turnText = (n: number) =>
      `Turn ${n}: ${"please consider this requirement. ".repeat(6)}`;

    // 14 short responses — one per prompt, no tool calls so each prompt is a
    // single streamFn call.
    registration.setResponses(
      Array.from(
        { length: 14 },
        (_, i) => () => fauxAssistantMessage(`answer ${i}`)
      )
    );

    const harness = new AgentHarness({
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: (req) => {
        captures.push(req);
        return registration.streamFn(req);
      },
      systemPrompt: "You are a helpful assistant. Be concise.",
    });

    for (let i = 0; i < 14; i++) {
      await harness.prompt(turnText(i));
    }

    expect(captures.length).toBe(14);

    const rates: number[] = [];
    for (let i = 1; i < captures.length; i++) {
      const result = measureCacheHit(
        captureRequest(captures[i - 1]!),
        captureRequest(captures[i]!)
      );
      // Every pair must remain prefix-stable (no cache busts).
      expect(
        result.prefixStable,
        `prefix broke at prompt ${i}: ${result.breakReason}`
      ).toBe(true);
      rates.push(result.hitRate);
    }

    // Peak hit rate should reach >= 90% — cumulative history dwarfs each turn.
    const peak = Math.max(...rates);
    expect(peak, `hit rates: [${rates.join(", ")}]`).toBeGreaterThanOrEqual(90);
  });

  it("tool schemas are sorted by name in the request regardless of registration order", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    const captures: StreamRequest[] = [];

    registration.setResponses([
      () => fauxAssistantMessage("done"),
      () => fauxAssistantMessage("done"),
    ]);

    // Register tools in NON-alphabetical order: zeta, alpha, middle.
    const zeta = makeEchoTool("zeta");
    const alpha = makeEchoTool("alpha");
    const middle = makeEchoTool("middle");

    const harness = new AgentHarness({
      compactionPrompts: TEST_COMPACTION_PROMPTS,
      env: new TestExecutionEnv(process.cwd()),
      session: await createTestSession(),
      model: registration.getModel(),
      streamFn: (req) => {
        captures.push(req);
        return registration.streamFn(req);
      },
      systemPrompt: "sorted-tools test",
      tools: [zeta, alpha, middle],
    });

    await harness.prompt("run once");

    expect(captures.length).toBeGreaterThanOrEqual(1);
    const toolsKeys = captures[0]!.tools
      ? Object.keys(captures[0]!.tools!)
      : [];
    expect(toolsKeys).toEqual(["alpha", "middle", "zeta"]);
  });
});
