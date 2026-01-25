# OpenCode Model Provider and Agent Orchestration Architecture

This document provides a comprehensive analysis of how the model provider system integrates with tool and agent orchestration in the OpenCode codebase.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Model Provider System](#model-provider-system)
3. [Tool Orchestration](#tool-orchestration)
4. [Agent System](#agent-system)
5. [Session Management](#session-management)
6. [ACP (Agent Client Protocol) Integration](#acp-agent-client-protocol-integration)
7. [Integration Flow](#integration-flow)
8. [Key Design Patterns](#key-design-patterns)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           OpenCode Architecture                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐               │
│  │   Provider   │────▶│   Session    │────▶│    Agent     │               │
│  │   System     │     │   Manager    │     │   System     │               │
│  └──────────────┘     └──────────────┘     └──────────────┘               │
│         │                     │                     │                       │
│         ▼                     ▼                     ▼                       │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐               │
│  │ Tool Registry│────▶│   LLM Stream │────▶│  ACP Agent   │               │
│  │              │     │   Processor  │     │  (Protocol)  │               │
│  └──────────────┘     └──────────────┘     └──────────────┘               │
│         │                     │                     │                       │
│         ▼                     ▼                     ▼                       │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     Permission System                               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Model Provider System

### Models.dev Registry Integration

The key to OpenCode's extensive LLM support is the **models.dev** registry system.

#### Models.dev Schema (`/packages/opencode/src/provider/models.ts`)

```typescript
export namespace ModelsDev {
  export const Model = z.object({
    id: z.string(),
    name: z.string(),
    family: z.string().optional(),
    release_date: z.string(),
    attachment: z.boolean(),
    reasoning: z.boolean(),
    temperature: z.boolean(),
    tool_call: z.boolean(),
    interleaved: z.union([
      z.literal(true),
      z.object({
        field: z.enum(["reasoning_content", "reasoning_details"]),
      }).strict(),
    ]).optional(),
    cost: z.object({
      input: z.number(),
      output: z.number(),
      cache_read: z.number().optional(),
      cache_write: z.number().optional(),
      context_over_200k: z.object({
        input: z.number(),
        output: z.number(),
        cache_read: z.number().optional(),
        cache_write: z.number().optional(),
      }).optional(),
    }).optional(),
    limit: z.object({
      context: z.number(),
      input: z.number().optional(),
      output: z.number(),
    }),
    modalities: z.object({
      input: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
      output: z.array(z.enum(["text", "audio", "image", "video", "pdf"])),
    }).optional(),
    experimental: z.boolean().optional(),
    status: z.enum(["alpha", "beta", "deprecated"]).optional(),
    options: z.record(z.string(), z.any()),
    headers: z.record(z.string(), z.string()).optional(),
    provider: z.object({ npm: z.string() }).optional(),
    variants: z.record(z.string(), z.record(z.string(), z.any())).optional(),
  })

  export const Provider = z.object({
    api: z.string().optional(),
    name: z.string(),
    env: z.array(z.string()),
    id: z.string(),
    npm: z.string().optional(),
    models: z.record(z.string(), Model),
  })
```

#### Three-Tier Loading Strategy

```typescript
export const Data = lazy(async () => {
  const file = Bun.file(filepath);

  // 1. Try cache file first (fastest)
  const result = await file.json().catch(() => {});
  if (result) return result;

  // 2. Try bundled snapshot (from build time)
  const snapshot = await import("./models-snapshot")
    .then(m => m.snapshot as Record<string, unknown>)
    .catch(() => undefined);
  if (snapshot) return snapshot;

  // 3. Fetch from models.dev API (live update)
  if (Flag.OPENCODE_DISABLE_MODELS_FETCH) return {};
  const json = await fetch(`${url()}/api.json`).then(x => x.text());
  return JSON.parse(json);
});
```

#### Auto-Refresh Mechanism

```typescript
if (!Flag.OPENCODE_DISABLE_MODELS_FETCH) {
  // Initial fetch on startup
  ModelsDev.refresh();

  // Refresh every hour
  setInterval(
    async () => {
      await ModelsDev.refresh();
    },
    60 * 60 * 1000
  ).unref();
}

export async function refresh() {
  const file = Bun.file(filepath);
  log.info("refreshing", { file });

  const result = await fetch(`${url()}/api.json`, {
    headers: {
      "User-Agent": Installation.USER_AGENT,
    },
    signal: AbortSignal.timeout(10 * 1000),
  }).catch(e => {
    log.error("Failed to fetch models.dev", { error: e });
  });

  if (result && result.ok) {
    // Write to cache for next startup
    await Bun.write(file, await result.text());
    // Reset lazy loader to use new data
    ModelsDev.Data.reset();
  }
}
```

#### Build-Time Snapshot Generation (`/packages/opencode/script/build.ts`)

```typescript
import { $ } from "bun";

// Fetch and generate models.dev snapshot during build
const modelsData = process.env.MODELS_DEV_API_JSON
  ? await Bun.file(process.env.MODELS_DEV_API_JSON).text()
  : await fetch(`https://models.dev/api.json`).then(x => x.text());

await Bun.write(
  path.join(dir, "src/provider/models-snapshot.ts"),
  `// Auto-generated by build.ts - do not edit\nexport const snapshot = ${modelsData} as const\n`
);
console.log("Generated models-snapshot.ts");
```

This creates a `models-snapshot.ts` file with all provider/model data bundled at build time, ensuring the app works even without network access.

#### Registry to Internal Model Conversion

```typescript
// In provider.ts
function fromModelsDevModel(provider: ModelsDev.Provider, model: ModelsDev.Model): Model {
  const m: Model = {
    id: model.id,
    providerID: provider.id,
    name: model.name,
    family: model.family,
    api: {
      id: model.id,
      url: provider.api!,
      npm: model.provider?.npm ?? provider.npm ?? "@ai-sdk/openai-compatible",
    },
    status: model.status ?? "active",
    headers: model.headers ?? {},
    options: model.options ?? {},
    cost: {
      input: model.cost?.input ?? 0,
      output: model.cost?.output ?? 0,
      cache: {
        read: model.cost?.cache_read ?? 0,
        write: model.cost?.cache_write ?? 0,
      },
      experimentalOver200K: model.cost?.context_over_200k
        ? {
            /* ... */
          }
        : undefined,
    },
    limit: {
      context: model.limit.context,
      input: model.limit.input,
      output: model.limit.output,
    },
    capabilities: {
      temperature: model.temperature,
      reasoning: model.reasoning,
      attachment: model.attachment,
      toolcall: model.tool_call,
      input: {
        text: model.modalities?.input?.includes("text") ?? false,
        audio: model.modalities?.input?.includes("audio") ?? false,
        image: model.modalities?.input?.includes("image") ?? false,
        video: model.modalities?.input?.includes("video") ?? false,
        pdf: model.modalities?.input?.includes("pdf") ?? false,
      },
      output: {
        text: model.modalities?.output?.includes("text") ?? true,
        /* ... */
      },
      interleaved: model.interleaved ?? false,
    },
    release_date: model.release_date,
    variants: {},
  };

  m.variants = mapValues(ProviderTransform.variants(m), v => v);
  return m;
}

export function fromModelsDevProvider(provider: ModelsDev.Provider): Info {
  return {
    id: provider.id,
    source: "custom",
    name: provider.name,
    env: provider.env ?? [],
    options: {},
    models: mapValues(provider.models, model => fromModelsDevModel(provider, model)),
  };
}

// Usage in provider state initialization
const state = Instance.state(async () => {
  const config = await Config.get();
  const modelsDev = await ModelsDev.get();
  const database = mapValues(modelsDev, fromModelsDevProvider);

  // database now contains all providers/models from models.dev registry
  // Can be extended with config file, env vars, and auth tokens

  return { models: languages, providers: database, sdk, modelLoaders };
});
```

### Core Provider Implementation (`/packages/opencode/src/provider/provider.ts`)

The Provider system is the foundation for managing LLM models across different providers.

#### Provider Schema Definition

```typescript
export const Model = z.object({
  id: z.string(),
  providerID: z.string(),
  api: z.object({
    id: z.string(),
    url: z.string(),
    npm: z.string(), // AI SDK package name
  }),
  name: z.string(),
  family: z.string().optional(),
  capabilities: z.object({
    temperature: z.boolean(),
    reasoning: z.boolean(),
    attachment: z.boolean(),
    toolcall: z.boolean(),
    input: z.object({
      text: z.boolean(),
      audio: z.boolean(),
      image: z.boolean(),
      video: z.boolean(),
      pdf: z.boolean(),
    }),
    output: z.object({
      text: z.boolean(),
      audio: z.boolean(),
      image: z.boolean(),
      video: z.boolean(),
      pdf: z.boolean(),
    }),
    interleaved: z.union([
      z.boolean(),
      z.object({
        field: z.enum(["reasoning_content", "reasoning_details"]),
      }),
    ]),
  }),
  cost: z.object({
    input: z.number(),
    output: z.number(),
    cache: z.object({
      read: z.number(),
      write: z.number(),
    }),
  }),
  limit: z.object({
    context: z.number(),
    input: z.number().optional(),
    output: z.number(),
  }),
  status: z.enum(["alpha", "beta", "deprecated", "active"]),
  options: z.record(z.string(), z.any()),
  headers: z.record(z.string(), z.string()),
  variants: z.record(z.string(), z.record(z.string(), z.any())).optional(),
});
```

#### Bundled Providers

The system includes bundled providers for direct import:

```typescript
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createAzure } from "@ai-sdk/azure";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createVertex } from "@ai-sdk/google-vertex";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createXai } from "@ai-sdk/xai";
// ... and more
```

#### Custom Provider Loaders

Different providers have special initialization requirements handled by `CUSTOM_LOADERS`:

```typescript
const CUSTOM_LOADERS: Record<string, CustomLoader> = {
  async anthropic() {
    return {
      autoload: false,
      options: {
        headers: {
          "anthropic-beta":
            "claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
        },
      },
    };
  },

  async openai() {
    return {
      autoload: false,
      async getModel(sdk: any, modelID: string) {
        return sdk.responses(modelID); // Uses Responses API
      },
    };
  },

  "github-copilot": async () => {
    return {
      autoload: false,
      async getModel(sdk: any, modelID: string) {
        return shouldUseCopilotResponsesApi(modelID) ? sdk.responses(modelID) : sdk.chat(modelID);
      },
    };
  },

  "amazon-bedrock": async input => {
    // Complex AWS credential chain handling
    const auth = await Auth.get("amazon-bedrock");
    const providerOptions: AmazonBedrockProviderSettings = {
      region: defaultRegion,
      credentialProvider: fromNodeProviderChain(),
    };
    return {
      autoload: true,
      options: providerOptions,
      async getModel(sdk: any, modelID: string, options?: Record<string, any>) {
        // Region prefix handling for Bedrock models
        if (modelID.startsWith("global.") || modelID.startsWith("jp.")) {
          return sdk.languageModel(modelID);
        }
        const region = options?.region ?? defaultRegion;
        // Apply region-specific prefixing...
        return sdk.languageModel(modelID);
      },
    };
  },
  // ... more providers
};
```

#### Provider State Management

```typescript
const state = Instance.state(async () => {
  const config = await Config.get();
  const modelsDev = await ModelsDev.get();
  const database = mapValues(modelsDev, fromModelsDevProvider);

  // 1. Load providers from config file
  for (const [providerID, provider] of configProviders) {
    // Merge config with database
  }

  // 2. Load providers from environment variables
  for (const [providerID, provider] of Object.entries(database)) {
    const apiKey = provider.env.map(item => env[item]).find(Boolean);
    if (apiKey) {
      mergeProvider(providerID, { source: "env", key: apiKey });
    }
  }

  // 3. Load from stored API keys
  for (const [providerID, provider] of await Auth.all()) {
    if (provider.type === "api") {
      mergeProvider(providerID, { source: "api", key: provider.key });
    }
  }

  // 4. Apply custom loaders
  for (const [providerID, fn] of Object.entries(CUSTOM_LOADERS)) {
    const result = await fn(data);
    if (result.autoload || providers[providerID]) {
      mergeProvider(providerID, { source: "custom", options: result.options });
    }
  }

  return {
    models: languages, // Cached language models
    providers, // Available providers
    sdk, // Initialized SDK instances
    modelLoaders, // Custom model loaders
  };
});
```

#### Language Model Resolution

```typescript
export async function getLanguage(model: Model): Promise<LanguageModelV2> {
  const s = await state();
  const key = `${model.providerID}/${model.id}`;

  // Check cache first
  if (s.models.has(key)) return s.models.get(key)!;

  const sdk = await getSDK(model); // Get or create SDK instance

  try {
    // Use custom loader if available
    const language = s.modelLoaders[model.providerID]
      ? await s.modelLoaders[model.providerID](sdk, model.api.id, provider.options)
      : sdk.languageModel(model.api.id);

    s.models.set(key, language);
    return language;
  } catch (e) {
    if (e instanceof NoSuchModelError)
      throw new ModelNotFoundError(
        { modelID: model.id, providerID: model.providerID },
        { cause: e }
      );
    throw e;
  }
}
```

### Provider Transform System (`/packages/opencode/src/provider/transform.ts`)

The `ProviderTransform` module handles message and option transformation for different provider requirements.

#### Message Transformation

```typescript
export function message(
  msgs: ModelMessage[],
  model: Provider.Model,
  options: Record<string, unknown>
) {
  // 1. Filter unsupported modalities
  msgs = unsupportedParts(msgs, model);

  // 2. Normalize messages (tool call IDs, empty content, etc.)
  msgs = normalizeMessages(msgs, model, options);

  // 3. Apply caching for Anthropic
  if (model.providerID === "anthropic" || model.api.id.includes("anthropic")) {
    msgs = applyCaching(msgs, model.providerID);
  }

  // 4. Remap providerOptions keys
  const key = sdkKey(model.api.npm);
  if (key && key !== model.providerID) {
    msgs = msgs.map(msg => ({
      ...msg,
      providerOptions: remapKeys(msg.providerOptions, model.providerID, key),
    }));
  }

  return msgs;
}
```

#### Reasoning Variants

Different providers support different reasoning modes:

```typescript
export function variants(model: Provider.Model): Record<string, Record<string, any>> {
  if (!model.capabilities.reasoning) return {};

  switch (model.api.npm) {
    case "@ai-sdk/openai":
      return {
        minimal: { reasoningEffort: "minimal", reasoningSummary: "auto" },
        low: { reasoningEffort: "low", reasoningSummary: "auto" },
        medium: { reasoningEffort: "medium", reasoningSummary: "auto" },
        high: { reasoningEffort: "high", reasoningSummary: "auto" },
        xhigh: { reasoningEffort: "xhigh", reasoningSummary: "auto" },
      };

    case "@ai-sdk/anthropic":
      return {
        high: { thinking: { type: "enabled", budgetTokens: 16000 } },
        max: { thinking: { type: "enabled", budgetTokens: 31999 } },
      };

    case "@ai-sdk/google":
      return {
        low: { thinkingConfig: { includeThoughts: true, thinkingLevel: "low" } },
        high: { thinkingConfig: { includeThoughts: true, thinkingLevel: "high" } },
      };
  }
  return {};
}
```

---

## Tool Orchestration

### Tool Definition (`/packages/opencode/src/tool/tool.ts`)

The Tool system provides a standardized interface for all tools.

#### Core Tool Interface

```typescript
export interface Info<Parameters extends z.ZodType = z.ZodType, M extends Metadata = Metadata> {
  id: string;
  init: (ctx?: InitContext) => Promise<{
    description: string;
    parameters: Parameters;
    execute(
      args: z.infer<Parameters>,
      ctx: Context
    ): Promise<{
      title: string;
      metadata: M;
      output: string;
      attachments?: MessageV2.FilePart[];
    }>;
    formatValidationError?(error: z.ZodError): string;
  }>;
}

export type Context<M extends Metadata = Metadata> = {
  sessionID: string;
  messageID: string;
  agent: string;
  abort: AbortSignal;
  callID?: string;
  extra?: { [key: string]: any };
  metadata(input: { title?: string; metadata?: M }): void;
  ask(input: Omit<PermissionNext.Request, "id" | "sessionID" | "tool">): Promise<void>;
};
```

#### Tool Definition Helper

```typescript
export function define<Parameters extends z.ZodType, Result extends Metadata>(
  id: string,
  init: Info<Parameters, Result>["init"] | Awaited<ReturnType<Info<Parameters, Result>["init"]>>
): Info<Parameters, Result> {
  return {
    id,
    init: async initCtx => {
      const toolInfo = init instanceof Function ? await init(initCtx) : init;
      const execute = toolInfo.execute;

      // Wrap execute with automatic parameter validation and truncation
      toolInfo.execute = async (args, ctx) => {
        // Validate parameters
        try {
          toolInfo.parameters.parse(args);
        } catch (error) {
          if (error instanceof z.ZodError && toolInfo.formatValidationError) {
            throw new Error(toolInfo.formatValidationError(error), { cause: error });
          }
          throw new Error(`Invalid arguments for ${id}: ${error}`, { cause: error });
        }

        // Execute
        const result = await execute(args, ctx);

        // Skip truncation if tool handles it itself
        if (result.metadata.truncated !== undefined) {
          return result;
        }

        // Auto-truncate output
        const truncated = await Truncate.output(result.output, {}, initCtx?.agent);
        return {
          ...result,
          output: truncated.content,
          metadata: {
            ...result.metadata,
            truncated: truncated.truncated,
            ...(truncated.truncated && { outputPath: truncated.outputPath }),
          },
        };
      };
      return toolInfo;
    },
  };
}
```

### Tool Registry (`/packages/opencode/src/tool/registry.ts`)

The Tool Registry manages all available tools.

```typescript
export namespace ToolRegistry {
  const state = Instance.state(async () => {
    const custom = [] as Tool.Info[];

    // 1. Load custom tools from {tool,tools}/*.{js,ts}
    const glob = new Bun.Glob("{tool,tools}/*.{js,ts}");
    for (const dir of await Config.directories()) {
      for await (const match of glob.scan({ cwd: dir, absolute: true })) {
        const namespace = path.basename(match, path.extname(match));
        const mod = await import(match);
        for (const [id, def] of Object.entries<ToolDefinition>(mod)) {
          custom.push(fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def));
        }
      }
    }

    // 2. Load from plugins
    const plugins = await Plugin.list();
    for (const plugin of plugins) {
      for (const [id, def] of Object.entries(plugin.tool ?? {})) {
        custom.push(fromPlugin(id, def));
      }
    }

    return { custom };
  });

  async function all(): Promise<Tool.Info[]> {
    const custom = await state().then(x => x.custom);
    const config = await Config.get();

    return [
      InvalidTool,
      ...(Flag.OPENCODE_CLIENT === "app" ? [QuestionTool] : []),
      BashTool,
      ReadTool,
      GlobTool,
      GrepTool,
      EditTool,
      WriteTool,
      TaskTool,
      WebFetchTool,
      TodoWriteTool,
      TodoReadTool,
      WebSearchTool,
      CodeSearchTool,
      SkillTool,
      ApplyPatchTool,
      ...(Flag.OPENCODE_EXPERIMENTAL_LSP_TOOL ? [LspTool] : []),
      ...(config.experimental?.batch_tool === true ? [BatchTool] : []),
      ...(Flag.OPENCODE_EXPERIMENTAL_PLAN_MODE ? [PlanExitTool, PlanEnterTool] : []),
      ...custom,
    ];
  }

  export async function tools(model: { providerID: string; modelID: string }, agent?: Agent.Info) {
    const tools = await all();
    const result = await Promise.all(
      tools
        .filter(t => {
          // Enable websearch/codesearch for zen users OR via enable flag
          if (t.id === "codesearch" || t.id === "websearch") {
            return model.providerID === "opencode" || Flag.OPENCODE_ENABLE_EXA;
          }

          // Use apply_patch tool in same format as codex
          const usePatch =
            model.modelID.includes("gpt-") &&
            !model.modelID.includes("oss") &&
            !model.modelID.includes("gpt-4");
          if (t.id === "apply_patch") return usePatch;
          if (t.id === "edit" || t.id === "write") return !usePatch;

          return true;
        })
        .map(async t => ({
          id: t.id,
          ...(await t.init({ agent })),
        }))
    );
    return result;
  }
}
```

### Example: Bash Tool (`/packages/opencode/src/tool/bash.ts`)

```typescript
export const BashTool = Tool.define("bash", async () => {
  const shell = Shell.acceptable()

  return {
    description: DESCRIPTION,
    parameters: z.object({
      command: z.string().describe("The command to execute"),
      timeout: z.number().optional(),
      workdir: z.string().optional(),
      description: z.string(),
    }),

    async execute(params, ctx) {
      const cwd = params.workdir || Instance.directory
      const timeout = params.timeout ?? DEFAULT_TIMEOUT

      // Parse command to detect external directories and permission patterns
      const tree = await parser().then((p) => p.parse(params.command))
      const directories = new Set<string>()
      const patterns = new Set<string>()
      const always = new Set<string>()

      for (const node of tree.rootNode.descendantsOfType("command")) {
        const command = /* extract command from AST */

        // Check for file operations that might access external directories
        if (["cd", "rm", "cp", "mv", "mkdir"].includes(command[0])) {
          for (const arg of command.slice(1)) {
            const resolved = await $`realpath ${arg}`.cwd(cwd).quiet().text()
            if (!Instance.containsPath(resolved)) directories.add(resolved)
          }
        }

        patterns.add(command.join(" "))
        always.add(BashArity.prefix(command).join(" ") + "*")
      }

      // Request permissions
      if (directories.size > 0) {
        await ctx.ask({
          permission: "external_directory",
          patterns: Array.from(directories),
          always: Array.from(directories).map((x) => path.dirname(x) + "*"),
          metadata: {},
        })
      }

      if (patterns.size > 0) {
        await ctx.ask({
          permission: "bash",
          patterns: Array.from(patterns),
          always: Array.from(always),
          metadata: {},
        })
      }

      // Execute command
      const proc = spawn(params.command, { shell, cwd, stdio: ["ignore", "pipe", "pipe"] })
      let output = ""

      // Stream output to metadata
      const append = (chunk: Buffer) => {
        output += chunk.toString()
        ctx.metadata({
          metadata: {
            output: output.length > MAX_METADATA_LENGTH
              ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..."
              : output,
            description: params.description,
          },
        })
      }

      proc.stdout?.on("data", append)
      proc.stderr?.on("data", append)

      // Handle timeout and abort
      const timeoutTimer = setTimeout(() => {
        timedOut = true
        Shell.killTree(proc)
      }, timeout)

      ctx.abort.addEventListener("abort", () => {
        aborted = true
        Shell.killTree(proc)
      })

      await new Promise<void>((resolve) => {
        proc.once("exit", resolve)
      })

      return {
        title: params.description,
        metadata: {
          output: output.length > MAX_METADATA_LENGTH
            ? output.slice(0, MAX_METADATA_LENGTH) + "\n\n..."
            : output,
          exit: proc.exitCode,
          description: params.description,
        },
        output,
      }
    },
  }
})
```

---

## Agent System (`/packages/opencode/src/agent/agent.ts`)

The Agent system provides specialized agents with different capabilities and permission sets.

### Agent Schema

```typescript
export namespace Agent {
  export const Info = z.object({
    name: z.string(),
    description: z.string().optional(),
    mode: z.enum(["subagent", "primary", "all"]),
    native: z.boolean().optional(),      // Built-in agent
    hidden: z.boolean().optional(),
    topP: z.number().optional(),
    temperature: z.number().optional(),
    color: z.string().optional(),
    permission: PermissionNext.Ruleset,
    model: z.object({
      modelID: z.string(),
      providerID: z.string(),
    }).optional(),
    prompt: z.string().optional(),
    options: z.record(z.string(), z.any()),
    steps: z.number().int().positive().optional(),
  })
  export type Info = z.infer<typeof Info>
```

### Built-in Agents

```typescript
const result: Record<string, Info> = {
  build: {
    name: "build",
    permission: PermissionNext.merge(
      defaults,
      PermissionNext.fromConfig({
        question: "allow",
        plan_enter: "allow",
      }),
      user
    ),
    mode: "primary",
    native: true,
  },

  plan: {
    name: "plan",
    permission: PermissionNext.merge(
      defaults,
      PermissionNext.fromConfig({
        question: "allow",
        plan_exit: "allow",
        edit: {
          "*": "deny",
          [path.join(".opencode", "plans", "*.md")]: "allow",
        },
      }),
      user
    ),
    mode: "primary",
    native: true,
  },

  general: {
    name: "general",
    description:
      "General-purpose agent for researching complex questions and executing multi-step tasks.",
    permission: PermissionNext.merge(
      defaults,
      PermissionNext.fromConfig({
        todoread: "deny",
        todowrite: "deny",
      }),
      user
    ),
    mode: "subagent",
    native: true,
  },

  explore: {
    name: "explore",
    permission: PermissionNext.merge(
      defaults,
      PermissionNext.fromConfig({
        "*": "deny",
        grep: "allow",
        glob: "allow",
        list: "allow",
        bash: "allow",
        webfetch: "allow",
        websearch: "allow",
        codesearch: "allow",
        read: "allow",
      }),
      user
    ),
    description: `Fast agent specialized for exploring codebases. Use this when you need to quickly find files by patterns.`,
    prompt: PROMPT_EXPLORE,
    mode: "subagent",
    native: true,
  },

  compaction: {
    name: "compaction",
    mode: "primary",
    native: true,
    hidden: true,
    prompt: PROMPT_COMPACTION,
    permission: PermissionNext.merge(defaults, PermissionNext.fromConfig({ "*": "deny" }), user),
  },

  title: {
    name: "title",
    mode: "primary",
    native: true,
    hidden: true,
    temperature: 0.5,
    permission: PermissionNext.merge(defaults, PermissionNext.fromConfig({ "*": "deny" }), user),
    prompt: PROMPT_TITLE,
  },

  summary: {
    name: "summary",
    mode: "primary",
    native: true,
    hidden: true,
    permission: PermissionNext.merge(defaults, PermissionNext.fromConfig({ "*": "deny" }), user),
    prompt: PROMPT_SUMMARY,
  },
};
```

### Agent Generation

```typescript
export async function generate(input: {
  description: string;
  model?: { providerID: string; modelID: string };
}) {
  const cfg = await Config.get();
  const defaultModel = input.model ?? (await Provider.defaultModel());
  const model = await Provider.getModel(defaultModel.providerID, defaultModel.modelID);
  const language = await Provider.getLanguage(model);

  const system = SystemPrompt.header(defaultModel.providerID);
  system.push(PROMPT_GENERATE);
  const existing = await list();

  const params = {
    temperature: 0.3,
    messages: [
      ...system.map(
        (item): ModelMessage => ({
          role: "system",
          content: item,
        })
      ),
      {
        role: "user",
        content: `Create an agent configuration based on: "${input.description}".
IMPORTANT: Existing agents: ${existing.map(i => i.name).join(", ")}
Return ONLY the JSON object, no other text.`,
      },
    ],
    model: language,
    schema: z.object({
      identifier: z.string(),
      whenToUse: z.string(),
      systemPrompt: z.string(),
    }),
  };

  const result = await generateObject(params);
  return result.object;
}
```

---

## Session Management (`/packages/opencode/src/session/`)

### Session Schema

```typescript
export const Info = z.object({
  id: Identifier.schema("session"),
  slug: z.string(),
  projectID: z.string(),
  directory: z.string(),
  parentID: Identifier.schema("session").optional(),
  summary: z
    .object({
      additions: z.number(),
      deletions: z.number(),
      files: z.number(),
      diffs: Snapshot.FileDiff.array().optional(),
    })
    .optional(),
  share: z
    .object({
      url: z.string(),
    })
    .optional(),
  title: z.string(),
  version: z.string(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
    compacting: z.number().optional(),
    archived: z.number().optional(),
  }),
  permission: PermissionNext.Ruleset.optional(),
  revert: z
    .object({
      messageID: z.string(),
      partID: z.string().optional(),
      snapshot: z.string().optional(),
      diff: z.string().optional(),
    })
    .optional(),
});
```

### LLM Streaming (`/packages/opencode/src/session/llm.ts`)

The LLM module handles streaming text generation with tools.

```typescript
export namespace LLM {
  export type StreamInput = {
    user: MessageV2.User
    sessionID: string
    model: Provider.Model
    agent: Agent.Info
    system: string[]
    abort: AbortSignal
    messages: ModelMessage[]
    small?: boolean
    tools: Record<string, Tool>
    retries?: number
  }

  export async function stream(input: StreamInput) {
    const [language, cfg, provider, auth] = await Promise.all([
      Provider.getLanguage(input.model),
      Config.get(),
      Provider.getProvider(input.model.providerID),
      Auth.get(input.model.providerID),
    ])
    const isCodex = provider.id === "openai" && auth?.type === "oauth"

    // Build system prompt
    const system = SystemPrompt.header(input.model.providerID)
    system.push([
      ...(input.agent.prompt ? [input.agent.prompt] : isCodex ? [] : SystemPrompt.provider(input.model)),
      ...input.system,
      ...(input.user.system ? [input.user.system] : []),
    ].filter((x) => x).join("\n"))

    // Build options with precedence: model → agent → variant
    const base = input.small
      ? ProviderTransform.smallOptions(input.model)
      : ProviderTransform.options({
          model: input.model,
          sessionID: input.sessionID,
          providerOptions: provider.options,
        })
    const options: Record<string, any> = pipe(
      base,
      mergeDeep(input.model.options),
      mergeDeep(input.agent.options),
      mergeDeep(variant),
    )

    // Resolve tools (filter by permissions)
    const tools = await resolveTools(input)

    // Add dummy tool for LiteLLM proxy compatibility if needed
    const isLiteLLMProxy = /* detection logic */
    if (isLiteLLMProxy && Object.keys(tools).length === 0 && hasToolCalls(input.messages)) {
      tools["_noop"] = tool({
        description: "Placeholder for LiteLLM/Anthropic proxy compatibility",
        inputSchema: jsonSchema({ type: "object", properties: {} }),
        execute: async () => ({ output: "", title: "", metadata: {} }),
      })
    }

    return streamText({
      onError(error) { log.error("stream error", { error }) },
      async experimental_repairToolCall(failed) {
        // Tool call repair logic (case-insensitive tool names, error wrapping)
        const lower = failed.toolCall.toolName.toLowerCase()
        if (lower !== failed.toolCall.toolName && tools[lower]) {
          return { ...failed.toolCall, toolName: lower }
        }
        return {
          ...failed.toolCall,
          input: JSON.stringify({ tool: failed.toolCall.toolName, error: failed.error.message }),
          toolName: "invalid",
        }
      },
      temperature: params.temperature,
      topP: params.topP,
      topK: params.topK,
      providerOptions: ProviderTransform.providerOptions(input.model, params.options),
      activeTools: Object.keys(tools).filter((x) => x !== "invalid"),
      tools,
      maxOutputTokens,
      abortSignal: input.abort,
      headers: {
        ...(input.model.providerID.startsWith("opencode") ? {
          "x-opencode-project": Instance.project.id,
          "x-opencode-session": input.sessionID,
          "x-opencode-request": input.user.id,
          "x-opencode-client": Flag.OPENCODE_CLIENT,
        } : {}),
        ...input.model.headers,
        ...headers,
      },
      maxRetries: input.retries ?? 0,
      messages: [
        ...(isCodex ? [{
          role: "user",
          content: system.join("\n\n"),
        } as ModelMessage] : system.map((x): ModelMessage => ({
          role: "system",
          content: x,
        }))),
        ...input.messages,
      ],
      model: wrapLanguageModel({
        model: language,
        middleware: [
          {
            async transformParams(args) {
              if (args.type === "stream") {
                args.params.prompt = ProviderTransform.message(args.params.prompt, input.model, options)
              }
              return args.params
            },
          },
          extractReasoningMiddleware({ tagName: "think", startWithReasoning: false }),
        ],
      }),
      experimental_telemetry: { isEnabled: cfg.experimental?.openTelemetry },
    })
  }
}
```

### Session Processor (`/packages/opencode/src/session/processor.ts`)

The SessionProcessor handles the streaming loop and tool execution.

```typescript
export namespace SessionProcessor {
  export function create(input: {
    assistantMessage: MessageV2.Assistant;
    sessionID: string;
    model: Provider.Model;
    abort: AbortSignal;
  }) {
    const toolcalls: Record<string, MessageV2.ToolPart> = {};
    let snapshot: string | undefined;
    let blocked = false;
    let needsCompaction = false;

    return {
      async process(streamInput: LLM.StreamInput) {
        while (true) {
          try {
            const stream = await LLM.stream(streamInput);

            for await (const value of stream.fullStream) {
              input.abort.throwIfAborted();
              switch (value.type) {
                // Handle different stream events
                case "reasoning-start":
                case "reasoning-delta":
                case "reasoning-end":
                  // Reasoning content
                  break;

                case "tool-input-start":
                case "tool-input-delta":
                case "tool-input-end":
                  // Tool input streaming
                  break;

                case "tool-call": {
                  // Execute tool
                  const part = await Session.updatePart({
                    ...match,
                    state: {
                      status: "running",
                      input: value.input,
                      time: { start: Date.now() },
                    },
                    metadata: value.providerMetadata,
                  });

                  // Doom loop detection
                  const lastThree = parts.slice(-DOOM_LOOP_THRESHOLD);
                  if (
                    lastThree.every(
                      p =>
                        p.type === "tool" &&
                        p.tool === value.toolName &&
                        JSON.stringify(p.state.input) === JSON.stringify(value.input)
                    )
                  ) {
                    await PermissionNext.ask({
                      permission: "doom_loop",
                      patterns: [value.toolName],
                      sessionID: input.sessionID,
                      metadata: { tool: value.toolName, input: value.input },
                      always: [value.toolName],
                      ruleset: agent.permission,
                    });
                  }
                  break;
                }

                case "tool-result":
                  // Tool completed
                  await Session.updatePart({
                    ...match,
                    state: {
                      status: "completed",
                      input: value.input ?? match.state.input,
                      output: value.output.output,
                      metadata: value.output.metadata,
                      title: value.output.title,
                      time: {
                        start: match.state.time.start,
                        end: Date.now(),
                      },
                      attachments: value.output.attachments,
                    },
                  });
                  break;

                case "tool-error":
                  // Tool failed
                  if (value.error instanceof PermissionNext.RejectedError) {
                    blocked = shouldBreak;
                  }
                  break;

                case "start-step":
                  snapshot = await Snapshot.track();
                  break;

                case "finish-step":
                  // Calculate usage and cost
                  const usage = Session.getUsage({ model, usage: value.usage });
                  input.assistantMessage.finish = value.finishReason;
                  input.assistantMessage.cost += usage.cost;
                  input.assistantMessage.tokens = usage.tokens;

                  // Check if compaction needed
                  if (await SessionCompaction.isOverflow({ tokens: usage.tokens, model })) {
                    needsCompaction = true;
                  }
                  break;

                case "text-start":
                case "text-delta":
                case "text-end":
                  // Text streaming
                  break;
              }

              if (needsCompaction) break;
            }
          } catch (e) {
            // Error handling with retry logic
            const retry = SessionRetry.retryable(error);
            if (retry !== undefined) {
              attempt++;
              const delay = SessionRetry.delay(attempt, error);
              await SessionRetry.sleep(delay, input.abort);
              continue;
            }
            input.assistantMessage.error = error;
          }

          if (needsCompaction) return "compact";
          if (blocked) return "stop";
          if (input.assistantMessage.error) return "stop";
          return "continue";
        }
      },
    };
  }
}
```

---

## ACP (Agent Client Protocol) Integration (`/packages/opencode/src/acp/`)

The ACP integration allows external IDEs (like Zed) to use OpenCode as a backend.

### ACP Agent (`/packages/opencode/src/acp/agent.ts`)

```typescript
export class Agent implements ACPAgent {
  private connection: AgentSideConnection;
  private config: ACPConfig;
  private sdk: OpencodeClient;
  private sessionManager: ACPSessionManager;
  private permissionQueues = new Map<string, Promise<void>>();

  async initialize(params: InitializeRequest): Promise<InitializeResponse> {
    const authMethod: AuthMethod = {
      description: "Run `opencode auth login` in the terminal",
      name: "Login with opencode",
      id: "opencode-login",
    };

    // Terminal auth capability
    if (params.clientCapabilities?._meta?.["terminal-auth"] === true) {
      authMethod._meta = {
        "terminal-auth": {
          command: "opencode",
          args: ["auth", "login"],
          label: "OpenCode Login",
        },
      };
    }

    return {
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: true,
        mcpCapabilities: { http: true, sse: true },
        promptCapabilities: { embeddedContext: true, image: true },
        sessionCapabilities: { fork: {}, list: {}, resume: {} },
      },
      authMethods: [authMethod],
      agentInfo: {
        name: "OpenCode",
        version: Installation.VERSION,
      },
    };
  }

  async newSession(params: NewSessionRequest) {
    const directory = params.cwd;
    const model = await defaultModel(this.config, directory);

    // Create ACP session state
    const state = await this.sessionManager.create(params.cwd, params.mcpServers, model);
    const sessionId = state.id;

    // Load session mode (models, agents, commands)
    const load = await this.loadSessionMode({
      cwd: directory,
      mcpServers: params.mcpServers,
      sessionId,
    });

    return {
      sessionId,
      models: load.models,
      modes: load.modes,
    };
  }

  async prompt(params: PromptRequest) {
    const sessionID = params.sessionId;
    const session = this.sessionManager.get(sessionID);
    const directory = session.cwd;

    const current = session.model;
    const model = current ?? (await defaultModel(this.config, directory));
    const agent = session.modeId ?? (await AgentModule.defaultAgent());

    // Convert ACP prompt parts to OpenCode format
    const parts: Array<
      | { type: "text"; text: string; synthetic?: boolean; ignored?: boolean }
      | { type: "file"; url: string; filename: string; mime: string }
    > = [];

    for (const part of params.prompt) {
      switch (part.type) {
        case "text":
          const audience = part.annotations?.audience;
          const forAssistant = audience?.length === 1 && audience[0] === "assistant";
          const forUser = audience?.length === 1 && audience[0] === "user";
          parts.push({
            type: "text",
            text: part.text,
            ...(forAssistant && { synthetic: true }),
            ...(forUser && { ignored: true }),
          });
          break;

        case "image":
          if (part.data) {
            parts.push({
              type: "file",
              url: `data:${part.mimeType};base64,${part.data}`,
              filename: "image",
              mime: part.mimeType,
            });
          }
          break;

        case "resource_link":
        case "resource":
          // Convert to OpenCode format
          break;
      }
    }

    // Check for slash commands
    const cmd = (() => {
      const text = parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map(p => p.text)
        .join("")
        .trim();

      if (!text.startsWith("/")) return undefined;

      const [name, ...rest] = text.slice(1).split(/\s+/);
      return { name, args: rest.join(" ").trim() };
    })();

    if (!cmd) {
      // Regular prompt
      await this.sdk.session.prompt({
        sessionID,
        model: { providerID: model.providerID, modelID: model.modelID },
        parts,
        agent,
        directory,
      });
      return { stopReason: "end-turn" as const, _meta: {} };
    }

    // Handle built-in commands
    const command = await this.config.sdk.command
      .list({ directory }, { throwOnError: true })
      .then(x => x.data!.find(c => c.name === cmd.name));

    if (command) {
      await this.sdk.session.command({
        sessionID,
        command: command.name,
        arguments: cmd.args,
        model: model.providerID + "/" + model.modelID,
        agent,
        directory,
      });
      return { stopReason: "end-turn" as const, _meta: {} };
    }

    switch (cmd.name) {
      case "compact":
        await this.config.sdk.session.summarize(
          {
            sessionID,
            directory,
            providerID: model.providerID,
            modelID: model.modelID,
          },
          { throwOnError: true }
        );
        break;
    }

    return { stopReason: "end-turn" as const, _meta: {} };
  }
}
```

### Session Manager (`/packages/opencode/src/acp/session.ts`)

```typescript
export class ACPSessionManager {
  private sessions = new Map<string, ACPSessionState>();
  private sdk: OpencodeClient;

  async create(
    cwd: string,
    mcpServers: McpServer[],
    model?: ACPSessionState["model"]
  ): Promise<ACPSessionState> {
    const session = await this.sdk.session
      .create(
        {
          title: `ACP Session ${crypto.randomUUID()}`,
          directory: cwd,
        },
        { throwOnError: true }
      )
      .then(x => x.data!);

    const state: ACPSessionState = {
      id: session.id,
      cwd,
      mcpServers,
      createdAt: new Date(),
      model: model,
    };

    this.sessions.set(session.id, state);
    return state;
  }

  get(sessionId: string): ACPSessionState {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw RequestError.invalidParams(
        JSON.stringify({ error: `Session not found: ${sessionId}` })
      );
    }
    return session;
  }

  setModel(sessionId: string, model: ACPSessionState["model"]) {
    const session = this.get(sessionId);
    session.model = model;
    this.sessions.set(sessionId, session);
    return session;
  }

  setMode(sessionId: string, modeId: string) {
    const session = this.get(sessionId);
    session.modeId = modeId;
    this.sessions.set(sessionId, modeId);
    return session;
  }
}
```

---

## Integration Flow

### Complete Request Flow

```
User Input
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ 1. Request Received (ACP/CLI/App)                               │
│    - Parse input                                                 │
│    - Identify agent, model, tools                               │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Session Management                                           │
│    - Create/get session                                         │
│    - Load agent configuration                                   │
│    - Resolve model from Provider                                │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. Tool Registration                                            │
│    - Get available tools from ToolRegistry                      │
│    - Filter by agent permissions                               │
│    - Filter by model capabilities                              │
│    - Initialize each tool                                       │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. LLM Streaming (session/llm.ts)                               │
│    - Build system prompt                                        │
│    - Transform messages for provider                           │
│    - Configure options (temperature, topP, reasoning effort)    │
│    - Call AI SDK streamText()                                   │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. Session Processor Loop (session/processor.ts)                │
│    - Stream events: reasoning, text, tools                      │
│    - For tool calls:                                            │
│      a. Check permissions (PermissionNext)                      │
│      b. Detect doom loops (3 identical consecutive calls)       │
│      c. Execute tool with proper context                        │
│      d. Update tool part status                                 │
│    - Track snapshot for diff generation                         │
│    - Calculate usage/cost                                       │
│    - Handle errors with retry logic                             │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. Response Processing                                          │
│    - Compaction if context overflow                             │
│    - Generate summary                                           │
│    - Return to user/ACP                                         │
└─────────────────────────────────────────────────────────────────┘
```

### Tool Execution Flow

```
Tool Call Request
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ 1. Permission Check                                             │
│    - Check agent permission ruleset                            │
│    - Check user permissions (disabled tools)                    │
│    - Check explicit user tool disable                           │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Tool Initialization                                          │
│    - Get tool from registry                                     │
│    - Call tool.init({ agent })                                  │
│    - Get description, parameters, execute function             │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. Parameter Validation                                         │
│    - Validate args against zod schema                          │
│    - Call formatValidationError if provided                      │
│    - Throw error if validation fails                           │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. Context Setup                                                │
│    - sessionID, messageID, agent, abort                         │
│    - callID for tool identification                            │
│    - metadata() callback for streaming updates                 │
│    - ask() callback for permission requests                    │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. Tool Execution                                               │
│    - Tool executes its logic                                    │
│    - May call ctx.ask() for additional permissions              │
│    - May call ctx.metadata() for streaming progress             │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. Output Truncation                                            │
│    - Check if output exceeds limits                            │
│    - Write to temp file if needed                              │
│    - Return truncated content with metadata                     │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ 7. Result Return                                                │
│    - { title, metadata, output, attachments? }                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Design Patterns

### 1. Instance State Pattern

```typescript
const state = Instance.state(async () => {
  // Expensive initialization
  const config = await Config.get();
  const database = await loadDatabase();
  // Merge with user config
  return { providers, models, sdk };
});

// Cached per project instance
export async function list() {
  return state().then(s => s.providers);
}
```

### 2. Provider Options Merging

```typescript
// Precedence: ProviderTransform.options → model.options → agent.options → variant
const base = ProviderTransform.options({
  model: input.model,
  sessionID: input.sessionID,
  providerOptions: provider.options,
});

const options: Record<string, any> = pipe(
  base,
  mergeDeep(input.model.options),
  mergeDeep(input.agent.options),
  mergeDeep(variant)
);
```

### 3. Permission Ruleset Merging

```typescript
const defaults = PermissionNext.fromConfig({
  "*": "allow",
  doom_loop: "ask",
  external_directory: { "*": "ask", [Truncate.DIR]: "allow" },
  read: { "*.env": "ask" },
});

const user = PermissionNext.fromConfig(cfg.permission ?? {});

const agentPermission = PermissionNext.merge(
  defaults,
  PermissionNext.fromConfig({ question: "allow" }),
  user
);
```

### 4. Tool Call Repair

```typescript
async experimental_repairToolCall(failed) {
  // Case-insensitive tool name repair
  const lower = failed.toolCall.toolName.toLowerCase()
  if (lower !== failed.toolCall.toolName && tools[lower]) {
    return { ...failed.toolCall, toolName: lower }
  }

  // Error wrapping for invalid tools
  return {
    ...failed.toolCall,
    input: JSON.stringify({ tool: failed.toolCall.toolName, error: failed.error.message }),
    toolName: "invalid",
  }
}
```

### 5. Doom Loop Detection

```typescript
const DOOM_LOOP_THRESHOLD = 3;

const lastThree = parts.slice(-DOOM_LOOP_THRESHOLD);
if (
  lastThree.every(
    p =>
      p.type === "tool" &&
      p.tool === value.toolName &&
      JSON.stringify(p.state.input) === JSON.stringify(value.input)
  )
) {
  await PermissionNext.ask({
    permission: "doom_loop",
    patterns: [value.toolName],
    sessionID: input.sessionID,
    metadata: { tool: value.toolName, input: value.input },
    always: [value.toolName],
    ruleset: agent.permission,
  });
}
```

### 6. Session Compaction

```typescript
if (await SessionCompaction.isOverflow({ tokens: usage.tokens, model })) {
  needsCompaction = true;
}

// After loop completes
if (needsCompaction) {
  return "compact"; // Triggers compaction workflow
}
```

### 7. Multi-Provider SDK Caching

```typescript
const key = Bun.hash.xxHash32(JSON.stringify({ npm: model.api.npm, options }));
const existing = s.sdk.get(key);
if (existing) return existing;

const loaded = bundledFn({ name: model.providerID, ...options });
s.sdk.set(key, loaded);
return loaded;
```

---

## Summary

The OpenCode architecture demonstrates several key strengths:

1. **Provider Abstraction**: Unified interface for 20+ LLM providers with custom loaders for special cases
2. **Tool System**: Extensible tool registry with automatic validation, truncation, and permission handling
3. **Agent Specialization**: Built-in agents with different permission sets and custom prompts
4. **Session Management**: Complete session lifecycle with compaction, forking, and history tracking
5. **ACP Protocol**: Standardized protocol for IDE integration with session state management
6. **Permission System**: Multi-layered permission checking with doom loop detection
7. **Streaming Architecture**: Real-time streaming of reasoning, text, and tool execution

The system is designed to be:

- **Extensible**: Easy to add new providers, tools, and agents
- **Performant**: Caching, lazy loading, and streaming
- **Reliable**: Error handling, retry logic, and validation
- **Secure**: Multi-layered permission system
- **Observable**: Event bus, logging, and telemetry
