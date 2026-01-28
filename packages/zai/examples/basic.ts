/**
 * Basic usage examples for @ekacode/zai
 *
 * Run with:
 *   tsx examples/basic.ts
 */

import { generateText, streamText } from "ai";
import { createZai } from "../src";

// Initialize the provider
const zai = createZai({
  apiKey: process.env.ZAI_API_KEY,
});

// Example 1: Simple text generation
async function simpleGeneration() {
  const { text, usage, finishReason } = await generateText({
    model: zai("glm-4.7"),
    prompt: "Explain quantum computing in one sentence.",
  });

  console.log("Response:", text);
  console.log("Tokens:", usage);
  console.log("Finish reason:", finishReason);
}

// Example 2: Streaming
async function streamingExample() {
  const { textStream } = await streamText({
    model: zai("glm-4.7"),
    prompt: "Write a haiku about artificial intelligence.",
  });

  console.log("Streaming output:");
  for await (const text of textStream) {
    process.stdout.write(text);
  }
  console.log("\n");
}

// Example 3: Multi-turn conversation
async function multiTurnConversation() {
  const messages = [
    { role: "user" as const, content: "My name is Alice." },
    { role: "assistant" as const, content: "Nice to meet you, Alice!" },
  ];

  const { text } = await generateText({
    model: zai("glm-4.7"),
    messages: [...messages, { role: "user" as const, content: "What's my name?" }],
  });

  console.log("Response:", text);
}

// Example 4: System prompt
async function systemPromptExample() {
  const { text } = await generateText({
    model: zai("glm-4.7"),
    system: "You are a helpful assistant who speaks like a pirate.",
    prompt: "Hello, how are you?",
  });

  console.log("Pirate response:", text);
}

// Example 5: Temperature and other parameters
async function parameterControl() {
  const { text } = await generateText({
    model: zai("glm-4.7"),
    prompt: "Tell me a creative story.",
    temperature: 0.9,
    maxOutputTokens: 200,
    topP: 0.9,
  });

  console.log("Creative story:", text);
}

// Run examples
async function main() {
  console.log("=== Basic Usage Examples ===\n");

  console.log("1. Simple Generation:");
  await simpleGeneration();
  console.log("\n");

  console.log("2. Streaming:");
  await streamingExample();
  console.log("\n");

  console.log("3. Multi-turn Conversation:");
  await multiTurnConversation();
  console.log("\n");

  console.log("4. System Prompt:");
  await systemPromptExample();
  console.log("\n");

  console.log("5. Parameter Control:");
  await parameterControl();
  console.log("\n");
}

main().catch(console.error);
