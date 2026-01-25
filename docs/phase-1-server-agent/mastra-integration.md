# Mastra Framework Integration

## Overview

ekacode uses Mastra as the agent orchestration framework. This document explains why Mastra was chosen, how it's integrated, and the architecture of our agent system.

## Why Mastra?

### Evaluation Criteria

| Framework     | Orchestration   | Streaming    | Tools          | TypeScript    | Decision         |
| ------------- | --------------- | ------------ | -------------- | ------------- | ---------------- |
| **Mastra**    | ✅ Built-in     | ✅ Native    | ✅ First-class | ✅ Written in | ✅ Chosen        |
| LangChain     | ✅ Mature       | ⚠️ Complex   | ✅ Good        | ⚠️ JS port    | ❌ Rejected      |
| Vercel AI SDK | ❌ No agents    | ✅ Native    | ⚠️ Manual      | ✅ Native     | ❌ Rejected      |
| Custom        | ✅ Full control | ✅ Can build | ✅ Custom      | ✅ Native     | ❌ Too much work |

### Mastra Advantages

1. **Agent Abstraction**: Built-in Agent class with tools
2. **Streaming First**: Designed for streaming responses
3. **Tool System**: First-class tool support with validation
4. **TypeScript**: Written in TypeScript from ground up
5. **Modern**: Active development, good community
6. **Integration**: Works with Vercel AI SDK seamlessly

### Trade-offs

| Pro                 | Con                          |
| ------------------- | ---------------------------- |
| Modern architecture | Newer, less mature           |
| TypeScript native   | Smaller community            |
| Streaming built-in  | Documentation gaps           |
| Tool system         | Less flexible than LangChain |

**Decision**: Mastra's modern architecture and TypeScript-first approach aligned with our goals. The smaller community was an acceptable trade-off for better type safety and simpler API.

## Mastra Instance

### Basic Setup

```typescript
// packages/ekacode/src/mastra.ts
import { Mastra } from "@mastra/core";

export const mastra = new Mastra({
  // Configuration will be expanded as we add features
});
```

**Why Minimal Configuration?**

- Mastra vNext is in active development
- Most configuration happens at Agent level
- Keeping it simple until we need advanced features

### Future Configuration

```typescript
// Future: Enhanced configuration
export const mastra = new Mastra({
  tools: {
    // Global tool registration
  },
  workflows: {
    // Workflow orchestration
  },
  logger: {
    // Structured logging
  },
  telemetry: {
    // Observability
  },
});
```

## Agent Architecture

### Coder Agent

```typescript
// packages/ekacode/src/agents/coder.ts
import { Agent } from "@mastra/core/agent";
import { openai } from "@ai-sdk/openai";

export const coderAgent = new Agent({
  id: "coder-agent",
  name: "Coding Agent",
  instructions: `You are an expert coding agent...`,
  model: openai("gpt-4o"),
  tools: {
    read: readTool,
    write: writeTool,
    edit: editTool,
    multiedit: multieditTool,
    applyPatch: applyPatchTool,
    ls: lsTool,
    glob: globTool,
  },
});
```

### Agent Components

1. **id**: Unique identifier for agent
2. **name**: Human-readable name
3. **instructions**: System prompt for LLM
4. **model**: LLM to use (via AI SDK)
5. **tools**: Available tools for this agent

### Tool Integration

```typescript
// Tools are plain objects with specific schema
const readTool = createTool({
  id: "read-file",
  description: "Read a file from the local filesystem.",
  inputSchema: z.object({
    filePath: z.string(),
    offset: z.coerce.number().min(0).optional(),
  }),
  outputSchema: z.object({
    content: z.string(),
    metadata: z.object({
      truncated: z.boolean(),
      lineCount: z.number(),
    }),
  }),
  execute: async ({ filePath, offset }, context) => {
    // Tool implementation
  },
});
```

**How Mastra Uses Tools**:

1. **Discovery**: Agent inspects tool schemas
2. **Planning**: LLM decides which tools to use
3. **Execution**: Mastra executes tools with validation
4. **Results**: Tool results fed back to LLM
5. **Iteration**: LLM can call more tools based on results

## Model Configuration

### OpenAI Integration

```typescript
import { openai } from "@ai-sdk/openai";

export const coderAgent = new Agent({
  model: openai("gpt-4o"),
  // ...
});
```

**Why OpenAI?**

- **GPT-4o**: Best model for code understanding
- **Function Calling**: Native tool use support
- **Streaming**: Fast token streaming
- **Reliability**: Most stable API

### Model Switching

```typescript
// Future: Support multiple providers
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";

const agents = {
  coder: new Agent({
    model: openai("gpt-4o"), // Best for code
  }),
  planner: new Agent({
    model: anthropic("claude-sonnet"), // Better for planning
  }),
};
```

### Environment Variables

```bash
# Required: OpenAI API key
OPENAI_API_KEY=sk-...

# Optional: Base URL for proxy
OPENAI_BASE_URL=https://api.openai.com/v1

# Optional: Organization
OPENAI_ORGANIZATION=org-...
```

## Streaming Support

### Vercel AI SDK Integration

```typescript
// Mastra uses AI SDK internally
// Streaming is automatic with Agent.generate()

const response = await coderAgent.generate("Read package.json");
// response.stream is a ReadableStream<StreamChunk>
```

### Stream Chunks

```typescript
// Future: Stream chunk types (for TanStack compatibility)
type StreamChunk =
  | { type: "text-delta"; text: string }
  | { type: "tool-call"; toolCall: ToolCall }
  | { type: "tool-result"; toolResult: ToolResult }
  | { type: "finish"; finish: Finish }
  | { type: "error"; error: Error };
```

**Why TanStack Format?**

- Standard format for AI UIs
- Compatible with `@ai-sdk/react`
- Renderer will use for display

## Multi-Agent Architecture

### Current State

```typescript
// Phase 1: Single agent
export const coderAgent = new Agent({
  /* ... */
});
```

### Future: Multiple Agents

```typescript
// Phase 6: Multi-agent system
export const agents = {
  // Full access agent (all tools)
  build: new Agent({
    id: "build-agent",
    tools: {
      /* all tools */
    },
  }),

  // Read-only planning agent
  plan: new Agent({
    id: "plan-agent",
    tools: { read, ls, glob }, // Read-only tools only
  }),

  // Research subagent
  general: new Agent({
    id: "general-agent",
    tools: { websearch, webfetch },
  }),

  // Codebase search specialist
  explore: new Agent({
    id: "explore-agent",
    tools: { grep, codesearch, glob },
  }),
};
```

### Agent Delegation

```typescript
// Future: Agents can call other agents
const buildAgent = new Agent({
  instructions: `
    You are the build agent.
    Delegate research to the general agent.
    Delegate exploration to the explore agent.
  `,
  // ... configuration
});
```

## Tool System Design

### Tool Schema

```typescript
// Mastra uses Zod for validation
const inputSchema = z.object({
  filePath: z.string().describe("Path to the file"),
  offset: z.coerce.number().min(0).optional(),
});

// Generates JSON Schema for LLM
const jsonSchema = zodToJsonSchema(inputSchema);
// {
//   "type": "object",
//   "properties": {
//     "filePath": { "type": "string", "description": "..." }
//   }
// }
```

### Tool Execution Context

```typescript
// Mastra passes context to tools
interface ExecutionContext {
  sessionID: string;
  messageID: string;
  agent: string;
  abort?: AbortSignal;
  // ... tool-specific context
}
```

### Tool Registry

```typescript
// Central registry for all tools
export const toolRegistry = {
  read: readTool,
  write: writeTool,
  edit: editTool,
  // ...

  getAll() {
    return this as any;
  },

  getToolNames() {
    return Object.keys(this);
  },
};
```

## Error Handling

### Tool Errors

```typescript
// Tools throw errors, Mastra catches them
execute: async ({ filePath }, context) => {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  // ...
};
```

### Agent Error Propagation

```typescript
try {
  const response = await coderAgent.generate(userMessage);
} catch (error) {
  // Mastra wraps errors
  if (error instanceof ToolExecutionError) {
    console.error("Tool failed:", error.toolName);
  }
}
```

## Performance Considerations

### Tool Call Optimization

```typescript
// Tools should be fast
// Don't do heavy computation in tools

// Bad: Expensive operation in tool
execute: async () => {
  const result = await expensiveOperation(); // Blocks agent
  return result;
};

// Good: Delegate to background
execute: async () => {
  const id = queueOperation();
  return { id, status: "queued" };
};
```

### Streaming Tool Results

```typescript
// Future: Stream large tool results
execute: async function* ({ filePath }) {
  yield { type: "progress", value: 0.1 };
  const content = await readFile(filePath);
  yield { type: "progress", value: 0.5 };
  yield { type: "result", value: content };
}
```

## Testing Strategy

### Unit Tests

```typescript
describe("coderAgent", () => {
  it("should call read tool", async () => {
    const result = await coderAgent.generate("Read package.json");
    // Verify tool was called
  });
});
```

### Tool Tests

```typescript
describe("readTool", () => {
  it("should read file contents", async () => {
    const result = await readTool.execute({
      filePath: "/tmp/test.txt",
    });
    expect(result.content).toBeDefined();
  });
});
```

## Future Enhancements

### Workflows

```typescript
// Mastra vNext: Workflow orchestration
import { Workflow } from "@mastra/core/workflows";

const codingWorkflow = new Workflow({
  id: "coding-workflow",
  steps: [
    { agent: plannerAgent, prompt: "Plan changes" },
    { agent: coderAgent, prompt: "Implement changes" },
    { agent: testerAgent, prompt: "Run tests" },
  ],
});
```

### Memory Integration

```typescript
// Agent with memory
export const coderAgent = new Agent({
  // ...
  memory: {
    type: "semantic",
    backend: "libsql",
  },
});
```

### Custom Tools

```typescript
// Dynamic tool loading
import { loadMCPTool } from "./mcp";

const githubTool = await loadMCPTool("github-mcp-server");
coderAgent.tools.github = githubTool;
```

---

_Updated: 2025-01-25_
