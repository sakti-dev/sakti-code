/**
 * Tool calling examples for @ekacode/zai
 *
 * Run with:
 *   tsx examples/tools.ts
 */

import type { ModelMessage } from "ai";
import { generateText, streamText } from "ai";
import { z } from "zod";
import { createZai } from "../src";

const zai = createZai({
  apiKey: process.env.ZAI_API_KEY,
});

// Example 1: Simple function calling
async function simpleToolCall() {
  const { text, toolCalls } = await generateText({
    model: zai("glm-4.7"),
    prompt: "What is the weather in Beijing?",
    tools: {
      getWeather: {
        description: "Get the current weather for a city",
        inputSchema: z.object({
          city: z.string(),
          unit: z.enum(["celsius", "fahrenheit"]).default("celsius"),
        }),
      },
    },
  });

  console.log("Response:", text);
  console.log("Tool calls:", toolCalls);
}

// Example 2: Multiple tools
async function multipleTools() {
  const { text, toolCalls } = await generateText({
    model: zai("glm-4.7"),
    prompt: "What time is it and what is the weather in Tokyo?",
    tools: {
      getCurrentTime: {
        description: "Get the current time",
        inputSchema: z.object({
          timezone: z.string().default("UTC"),
        }),
      },
      getWeather: {
        description: "Get weather for a city",
        inputSchema: z.object({
          city: z.string(),
        }),
      },
    },
  });

  console.log("Response:", text);
  if (toolCalls) {
    for (const toolCall of toolCalls) {
      console.log("Called:", toolCall.toolName, "with input:", toolCall.input);
    }
  }
}

// Example 3: Tool streaming
async function toolStreaming() {
  const result = await streamText({
    model: zai("glm-4.7"),
    prompt: "Calculate 25 * 37 + 42",
    tools: {
      calculate: {
        description: "Perform a mathematical calculation",
        inputSchema: z.object({
          expression: z.string(),
        }),
      },
    },
    providerOptions: {
      zai: {
        tool_stream: true,
      },
    },
  });

  console.log("Text stream:");
  for await (const text of result.textStream) {
    process.stdout.write(text);
  }
  console.log("\n");

  console.log("Tool argument stream:");
  for await (const part of result.fullStream) {
    if (part.type === "tool-input-delta") {
      process.stdout.write(part.delta);
    } else if (part.type === "tool-input-start") {
      console.log(`\nTool ${part.id} started`);
    } else if (part.type === "tool-input-end") {
      console.log("\nTool argument complete");
    } else if (part.type === "tool-call") {
      console.log("Tool call emitted");
    }
  }
}

// Example 4: Tool choice control
async function toolChoiceControl() {
  // Force tool use
  const { text: forceText } = await generateText({
    model: zai("glm-4.7"),
    prompt: "Hello",
    tools: {
      getTime: {
        description: "Get current time",
        inputSchema: z.object({}),
      },
    },
    toolChoice: "required",
  });
  console.log("Force tool:", forceText);

  // Prevent tool use
  const { text: noTool } = await generateText({
    model: zai("glm-4.7"),
    prompt: "What time is it?",
    tools: {
      getTime: {
        description: "Get current time",
        inputSchema: z.object({}),
      },
    },
    toolChoice: "none",
  });
  console.log("No tool:", noTool);
}

// Example 5: Multi-turn with tools
async function multiTurnWithTools() {
  const messages: ModelMessage[] = [
    {
      role: "user" as const,
      content: "What is the weather in Beijing?",
    },
  ];

  // First turn - model calls tool
  const { toolCalls } = await generateText({
    model: zai("glm-4.7"),
    messages,
    tools: {
      getWeather: {
        description: "Get weather for a city",
        inputSchema: z.object({
          city: z.string(),
        }),
      },
    },
  });

  // Simulate tool result
  if (toolCalls) {
    for (const toolCall of toolCalls) {
      messages.push({
        role: "assistant" as const,
        content: [toolCall],
      });

      messages.push({
        role: "tool" as const,
        content: [
          {
            type: "tool-result",
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            output: { type: "text", value: "25°C, sunny" },
          },
        ],
      });
    }

    // Second turn - model responds with tool result
    const { text } = await generateText({
      model: zai("glm-4.7"),
      messages,
    });

    console.log("Final response:", text);
  }
}

// Run examples
async function main() {
  console.log("=== Tool Calling Examples ===\n");

  console.log("1. Simple Tool Call:");
  await simpleToolCall();
  console.log("\n");

  console.log("2. Multiple Tools:");
  await multipleTools();
  console.log("\n");

  console.log("3. Tool Streaming:");
  await toolStreaming();
  console.log("\n");

  console.log("4. Tool Choice Control:");
  await toolChoiceControl();
  console.log("\n");

  console.log("5. Multi-turn with Tools:");
  await multiTurnWithTools();
  console.log("\n");
}

main().catch(console.error);
