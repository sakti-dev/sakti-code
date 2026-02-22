# @sakti-code/zai

[Z.ai](https://z.ai) provider for [Vercel AI SDK](https://sdk.vercel.ai) v3.

## Features

- **Chat completions** with streaming support
- **Tool calling** with function tools
- **Tool streaming** for real-time tool arguments
- **Thinking modes** (interleaved, preserved, turn-level)
- **Web search** integration
- **Retrieval** tools for knowledge bases
- **Structured output** (JSON mode)
- **Vision/multimodal** support
- **Context caching** for preserved thinking

## Installation

```bash
npm install @sakti-code/zai
# or
pnpm add @sakti-code/zai
# or
yarn add @sakti-code/zai
```

## Quick Start

```typescript
import { generateText } from "ai";
import { createZai } from "@sakti-code/zai";

// Initialize the provider
const zai = createZai({
  apiKey: process.env.ZAI_API_KEY,
});

// Generate text
const { text } = await generateText({
  model: zai("glm-4.7"),
  prompt: "Explain quantum computing in simple terms.",
});

console.log(text);
```

## Configuration

### Provider Settings

```typescript
import { createZai } from "@sakti-code/zai";

const zai = createZai({
  // API key (falls back to ZAI_API_KEY env var)
  apiKey: "your-api-key",

  // Base URL (optional, defaults to Z.ai general endpoint)
  baseURL: "https://api.z.ai/api/paas/v4",

  // Or use predefined endpoint
  endpoint: "general", // or 'coding' for https://api.z.ai/api/coding/paas/v4

  // Custom headers (optional)
  headers: {
    "X-Custom-Header": "value",
  },

  // Source channel for analytics (default: 'typescript-sdk')
  sourceChannel: "my-app",

  // Custom fetch function (optional)
  fetch: customFetch,
});
```

### Available Models

| Model ID                     | Description                    |
| ---------------------------- | ------------------------------ |
| `glm-4.7`                    | Latest GLM model with thinking |
| `glm-4.7-flash`              | Faster variant                 |
| `glm-4.7-flashx`             | Even faster                    |
| `glm-4.6`                    | Previous generation            |
| `glm-4.6v`                   | Vision-capable                 |
| `glm-4.6v-flash`             | Fast vision                    |
| `glm-4.5`                    | Earlier generation             |
| `glm-4.5-air`                | Lightweight                    |
| `glm-4.5-x`                  | Performance                    |
| `glm-4.5-flash`              | Fast                           |
| `glm-4.5v`                   | Vision                         |
| `autoglm-phone-multilingual` | Multilingual phone             |

## Usage Examples

### Streaming

```typescript
import { streamText } from "ai";
import { zai } from "@sakti-code/zai";

const { textStream } = await streamText({
  model: zai("glm-4.7"),
  prompt: "Write a short poem about AI.",
});

for await (const text of textStream) {
  process.stdout.write(text);
}
```

### Tool Calling

```typescript
import { generateText } from "ai";
import { zai } from "@sakti-code/zai";
import { z } from "zod";

const { text, toolCalls } = await generateText({
  model: zai("glm-4.7"),
  prompt: "What is the weather in Beijing?",
  tools: {
    getWeather: {
      description: "Get weather for a city",
      parameters: z.object({
        city: z.string(),
        unit: z.enum(["celsius", "fahrenheit"]).default("celsius"),
      }),
    },
  },
});

if (toolCalls) {
  for (const toolCall of toolCalls) {
    console.log("Tool call:", toolCall.toolName, toolCall.args);
  }
}
```

### Tool Streaming

```typescript
import { streamText } from "ai";
import { zai } from "@sakti-code/zai";
import { z } from "zod";

const { toolStream } = await streamText({
  model: zai("glm-4.7"),
  prompt: "Get the weather for Beijing and Tokyo",
  tools: {
    getWeather: {
      description: "Get weather for a city",
      parameters: z.object({
        city: z.string(),
      }),
    },
  },
  // Enable tool streaming for real-time tool arguments
  providerOptions: {
    tool_stream: true,
  },
});

// Stream tool deltas as they arrive
for await (const { type, delta, toolCallId } of toolStream) {
  if (type === "tool-input-delta") {
    process.stdout.write(delta);
  }
}
```

### Thinking Mode

```typescript
import { generateText } from "ai";
import { zai } from "@sakti-code/zai";

const { text, reasoning } = await generateText({
  model: zai("glm-4.7"),
  prompt: "Solve this step by step: 23 * 47 + 15",
  providerOptions: {
    thinking: {
      type: "enabled", // Enable thinking
      clear_thinking: false, // Preserve thinking in response
    },
  },
});

console.log("Reasoning:", reasoning);
console.log("Answer:", text);
```

### Web Search

```typescript
import { generateText } from "ai";
import { zai } from "@sakti-code/zai";

const { text, sources } = await generateText({
  model: zai("glm-4.7"),
  prompt: "What are the latest AI developments?",
  providerOptions: {
    web_search: {
      enable: true,
      search_result: true, // Include search results
      search_recency_filter: "oneWeek", // oneDay, oneWeek, oneMonth, oneYear, noLimit
      search_domain_filter: "arxiv.org", // Optional: limit to specific domains
      content_size: "high", // or 'medium' for shorter results
      result_sequence: "before", // 'before' or 'after'
    },
  },
});

// Access web search sources
for (const source of sources ?? []) {
  console.log("Source:", source.title, source.url);
}
```

### Retrieval (Knowledge Base)

```typescript
import { generateText } from "ai";
import { zai } from "@sakti-code/zai";

const { text } = await generateText({
  model: zai("glm-4.7"),
  prompt: "What does our documentation say about authentication?",
  providerOptions: {
    retrieval: {
      knowledge_id: "kb_123456",
      prompt_template: "Context: {context}\n\nQuestion: {question}",
    },
  },
});
```

### Vision/Multimodal

```typescript
import { generateText } from "ai";
import { zai } from "@sakti-code/zai";

const { text } = await generateText({
  model: zai("glm-4.6v"),
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "What do you see in this image?" },
        {
          type: "image",
          image: "https://example.com/image.jpg",
          // or base64: new URL('data:image/jpeg;base64,...')
        },
      ],
    },
  ],
});
```

### Structured Output (JSON Mode)

```typescript
import { generateObject } from "ai";
import { zai } from "@sakti-code/zai";
import { z } from "zod";

const { object } = await generateObject({
  model: zai("glm-4.7"),
  prompt: "Extract information from the following text...",
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    tags: z.array(z.string()),
  }),
});
```

### Multi-turn Conversations

```typescript
import { generateText } from "ai";
import { zai } from "@sakti-code/zai";

const chatHistory = [
  { role: "user", content: "Hello!" },
  { role: "assistant", content: "Hi! How can I help you today?" },
];

const { text } = await generateText({
  model: zai("glm-4.7"),
  messages: [...chatHistory, { role: "user", content: "Tell me a joke." }],
});

// Continue conversation
chatHistory.push(
  { role: "user", content: "Tell me a joke." },
  { role: "assistant", content: text }
);
```

## Provider Options Reference

### `thinking`

```typescript
{
  thinking: {
    type: 'enabled' | 'disabled',
    clear_thinking?: boolean, // If false, thinking is preserved in response
  }
}
```

### `tool_stream`

```typescript
{
  tool_stream: boolean, // Enable tool argument streaming
}
```

### `web_search`

```typescript
{
  web_search: {
    enable: boolean,
    search_query?: string,              // Override search query
    search_result?: boolean,            // Include search results in response
    require_search?: boolean,           // Force search even for simple queries
    search_domain_filter?: string,      // Limit to specific domain(s)
    search_recency_filter?: 'oneDay' | 'oneWeek' | 'oneMonth' | 'oneYear' | 'noLimit',
    content_size?: 'medium' | 'high',
    result_sequence?: 'before' | 'after', // Show results before or after AI response
  }
}
```

### `retrieval`

```typescript
{
  retrieval: {
    knowledge_id: string,
    prompt_template?: string, // Template with {context} and {question} placeholders
  }
}
```

### Additional Options

```typescript
{
  request_id?: string,              // Custom request ID
  user_id?: string,                 // User identifier
  seed?: number,                    // Random seed for reproducibility
  do_sample?: boolean,              // Enable/disable sampling
  meta?: Record<string, string>,    // Custom metadata
  sensitive_word_check?: {
    type?: string,
    status?: string,
  },
  watermark_enabled?: boolean,      // Enable watermarking
  extra?: Record<string, unknown>,  // Additional fields
}
```

## Error Handling

```typescript
import { generateText } from "ai";
import { zai } from "@sakti-code/zai";

try {
  const { text } = await generateText({
    model: zai("glm-4.7"),
    prompt: "Your prompt here",
  });
} catch (error) {
  if (error instanceof Error) {
    console.error("AI SDK Error:", error.message);
    // Handle specific error types
    if (error.message.includes("API key")) {
      console.error("Please check your ZAI_API_KEY");
    }
  }
}
```

## Environment Variables

```bash
# Required (unless passed in createZai)
ZAI_API_KEY=your-api-key-here

# Optional
ZAI_BASE_URL=https://api.z.ai/api/paas/v4
```

## License

MIT
