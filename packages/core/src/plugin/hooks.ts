/**
 * Agent type - inlined to avoid circular dependency in server exports
 */
export type AgentType = "explore" | "plan" | "build";

export interface ChatHookInput {
  sessionID: string;
  agent: string;
  model: { providerID: string; modelID: string };
  provider: { id: string };
  message: { role: "user"; content: string };
}

export interface ChatParamsOutput {
  temperature?: number;
  topP?: number;
  topK?: number;
  options: Record<string, unknown>;
}

export interface ChatHeadersOutput {
  headers: Record<string, string>;
}

export interface ToolDefinitionOutput {
  description: string;
  parameters: unknown;
}

export interface CorePluginHooks {
  "chat.params"?: (input: ChatHookInput, output: ChatParamsOutput) => Promise<void> | void;
  "chat.headers"?: (input: ChatHookInput, output: ChatHeadersOutput) => Promise<void> | void;
  "tool.definition"?: (
    input: { toolID: string },
    output: ToolDefinitionOutput
  ) => Promise<void> | void;
}

let activeHooks: CorePluginHooks = {};

export function setCorePluginHooks(hooks: CorePluginHooks): void {
  activeHooks = hooks;
}

export function clearCorePluginHooks(): void {
  activeHooks = {};
}

export async function triggerChatParamsHook(
  input: ChatHookInput,
  output: ChatParamsOutput
): Promise<ChatParamsOutput> {
  if (!activeHooks["chat.params"]) return output;
  await activeHooks["chat.params"](input, output);
  return output;
}

export async function triggerChatHeadersHook(
  input: ChatHookInput,
  output: ChatHeadersOutput
): Promise<ChatHeadersOutput> {
  if (!activeHooks["chat.headers"]) return output;
  await activeHooks["chat.headers"](input, output);
  return output;
}

function fallbackProviderID(input: { modelID: string; agentType: AgentType }): string {
  if (input.modelID.includes("/")) {
    return input.modelID.split("/")[0] || "zai-coding-plan";
  }
  if (input.agentType === "plan" || input.agentType === "build" || input.agentType === "explore") {
    return "zai-coding-plan";
  }
  return "zai";
}

export function resolveHookModel(input: {
  configuredModelID: string;
  agentType: AgentType;
  runtimeProviderID?: string;
  runtimeModelID?: string;
}): { providerID: string; modelID: string } {
  if (input.runtimeProviderID && input.runtimeModelID) {
    return {
      providerID: input.runtimeProviderID,
      modelID: input.runtimeModelID,
    };
  }

  if (input.configuredModelID.includes("/")) {
    const [providerID, ...rest] = input.configuredModelID.split("/");
    return {
      providerID:
        providerID ||
        fallbackProviderID({
          modelID: input.configuredModelID,
          agentType: input.agentType,
        }),
      modelID: rest.join("/") || input.configuredModelID,
    };
  }

  return {
    providerID: fallbackProviderID({
      modelID: input.configuredModelID,
      agentType: input.agentType,
    }),
    modelID: input.configuredModelID,
  };
}

export async function applyToolDefinitionHook(input: {
  tools: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const toolDefHook = activeHooks["tool.definition"];
  if (!toolDefHook) return input.tools;

  const nextTools: Record<string, unknown> = {};
  for (const [toolID, toolValue] of Object.entries(input.tools)) {
    const asRecord =
      toolValue && typeof toolValue === "object" ? (toolValue as Record<string, unknown>) : null;
    if (!asRecord) {
      nextTools[toolID] = toolValue;
      continue;
    }

    const output: ToolDefinitionOutput = {
      description: typeof asRecord.description === "string" ? asRecord.description : "",
      parameters:
        "inputSchema" in asRecord
          ? asRecord.inputSchema
          : "parameters" in asRecord
            ? asRecord.parameters
            : undefined,
    };

    await toolDefHook({ toolID }, output);

    nextTools[toolID] = {
      ...asRecord,
      ...(output.description ? { description: output.description } : {}),
      ...(output.parameters !== undefined
        ? "inputSchema" in asRecord
          ? { inputSchema: output.parameters }
          : { parameters: output.parameters }
        : {}),
    };
  }

  return nextTools;
}
