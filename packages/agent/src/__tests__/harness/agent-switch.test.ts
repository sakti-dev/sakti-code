import type { StreamRequest } from "@sakti-code/llm";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { AgentHarness } from "../../harness/agent-harness.ts";
import { InMemorySessionStorage } from "../../harness/memory-storage.ts";
import { Session } from "../../harness/session.ts";
import type { AgentDefinition } from "../../harness/types.ts";
import type { AgentTool } from "../../types.ts";
import {
  type FauxProviderRegistration,
  fauxAssistantMessage,
  fauxAssistantMessageWithContent,
  fauxToolCall,
  registerFauxStreamProvider,
} from "../helpers/faux-provider.ts";
import { TestExecutionEnv } from "./test-execution-env.ts";

const registrations: FauxProviderRegistration[] = [];

afterEach(() => {
  for (const registration of registrations.splice(0)) {
    registration.setResponses([]);
  }
});

const readSchema = Type.Object({ path: Type.String() });
const writeSchema = Type.Object({
  path: Type.String(),
  content: Type.String(),
});

function buildReadWriteTools() {
  const executed: string[] = [];
  const readTool: AgentTool<typeof readSchema, undefined> = {
    name: "read",
    label: "Read",
    description: "Read a file",
    parameters: readSchema,
    async execute(_id, params) {
      executed.push(`read:${params.path}`);
      return {
        content: [{ type: "text", text: params.path }],
        details: undefined,
      };
    },
    permissions: (params) => [
      { permission: "read", patterns: [(params as { path: string }).path] },
    ],
  };
  const writeTool: AgentTool<typeof writeSchema, undefined> = {
    name: "write",
    label: "Write",
    description: "Write a file",
    parameters: writeSchema,
    async execute(_id, params) {
      executed.push(`write:${params.path}`);
      return {
        content: [{ type: "text", text: `wrote ${params.path}` }],
        details: undefined,
      };
    },
    permissions: (params) => [
      { permission: "edit", patterns: [(params as { path: string }).path] },
    ],
  };
  return { readTool, writeTool, executed };
}

describe("AgentHarness.switchAgent", () => {
  it("records the agent, reduces active tools, overrides the system prompt and thinking level", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    const capturedSystem: string[] = [];
    registration.setResponses([
      (req: StreamRequest) => {
        capturedSystem.push(req.system ?? "");
        return fauxAssistantMessage("done");
      },
    ]);
    const { readTool, writeTool } = buildReadWriteTools();
    const harness = new AgentHarness({
      env: new TestExecutionEnv(process.cwd()),
      session: new Session(new InMemorySessionStorage()),
      model: registration.getModel(),
      streamFn: registration.streamFn,
      thinkingLevel: "off",
      systemPrompt: "base prompt",
      tools: [readTool, writeTool],
    });
    expect(harness.getActiveTools().map((tool) => tool.name)).toEqual([
      "read",
      "write",
    ]);

    const explore: AgentDefinition = {
      name: "explore",
      mode: "all",
      description: "read-only explorer",
      systemPrompt: "you are an explorer",
      activeToolNames: ["read"],
      thinkingLevel: "medium",
    };
    await harness.switchAgent(explore);

    expect(harness.getCurrentAgent()?.name).toBe("explore");
    expect(harness.getActiveTools().map((tool) => tool.name)).toEqual(["read"]);
    expect(harness.getThinkingLevel()).toBe("medium");

    await harness.prompt("hi");
    expect(capturedSystem[0]).toBe("you are an explorer");
  });

  it("forwards the permission evaluator so a denied edit is blocked", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    registration.setResponses([
      () =>
        fauxAssistantMessageWithContent(
          [fauxToolCall("write", { path: "secret.env", content: "x" })],
          "toolUse"
        ),
      () => fauxAssistantMessage("done"),
    ]);
    const { readTool, writeTool, executed } = buildReadWriteTools();
    const harness = new AgentHarness({
      env: new TestExecutionEnv(process.cwd()),
      session: new Session(new InMemorySessionStorage()),
      model: registration.getModel(),
      streamFn: registration.streamFn,
      thinkingLevel: "off",
      tools: [readTool, writeTool],
    });
    harness.setPermissionEvaluator((permission) =>
      permission === "edit" ? "deny" : "allow"
    );

    const toolResults: Array<{ name: string; isError: boolean }> = [];
    harness.subscribe((event) => {
      if (event.type === "tool_execution_end") {
        toolResults.push({ name: event.toolName, isError: event.isError });
      }
    });

    await harness.prompt("write the file");

    expect(executed).toEqual([]);
    expect(toolResults).toContainEqual({ name: "write", isError: true });
  });

  it("forwards the turn sessionId to resolvePermissionAsk requests", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    registration.setResponses([
      () =>
        fauxAssistantMessageWithContent(
          [fauxToolCall("read", { path: "secret.env" })],
          "toolUse"
        ),
      () => fauxAssistantMessage("done"),
    ]);
    const { readTool } = buildReadWriteTools();
    const session = new Session(new InMemorySessionStorage());
    const harness = new AgentHarness({
      env: new TestExecutionEnv(process.cwd()),
      session,
      model: registration.getModel(),
      streamFn: registration.streamFn,
      thinkingLevel: "off",
      tools: [readTool],
    });
    harness.setPermissionEvaluator(() => "ask");
    const expectedId = (await session.getMetadata()).id;
    let captured: string | undefined;
    harness.setPermissionAskResolver(async (req) => {
      captured = req.sessionId;
      return "allow";
    });

    await harness.prompt("read it");

    expect(captured).toBe(expectedId);
  });

  it("forwards resolvePermissionAsk so an ask the user allows proceeds", async () => {
    const registration = registerFauxStreamProvider();
    registrations.push(registration);
    registration.setResponses([
      () =>
        fauxAssistantMessageWithContent(
          [fauxToolCall("read", { path: "secret.env" })],
          "toolUse"
        ),
      () => fauxAssistantMessage("done"),
    ]);
    const { readTool, executed } = buildReadWriteTools();
    const harness = new AgentHarness({
      env: new TestExecutionEnv(process.cwd()),
      session: new Session(new InMemorySessionStorage()),
      model: registration.getModel(),
      streamFn: registration.streamFn,
      thinkingLevel: "off",
      tools: [readTool],
    });
    // read of anything is "ask"; the resolver allows it.
    harness.setPermissionEvaluator(() => "ask");
    harness.setPermissionAskResolver(async () => "allow");

    await harness.prompt("read it");

    expect(executed).toEqual(["read:secret.env"]);
  });
});
