/**
 * Hybrid Agent Example
 *
 * Demonstrates usage of the createZaiHybridAgent for intelligent image analysis.
 *
 * Run with:
 *   tsx examples/hybrid-agent.ts
 */

import { createZaiHybridAgent } from "@ekacode/ekacode";
import { generateText, streamText } from "ai";

// Create the hybrid agent with Z.ai models
const agent = createZaiHybridAgent({
  apiKey: process.env.ZAI_API_KEY,
  // textModelId defaults to "glm-4.7"
  // visionModelId defaults to "glm-4.6v"
});

// Example 1: Basic image analysis (general intent)
async function basicImageAnalysis() {
  console.log("=== Example 1: Basic Image Analysis ===\n");

  // Simulating a base64 image (in real usage, this would be actual image data)
  const base64Image =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  const { text } = await generateText({
    model: agent,
    prompt: [
      {
        role: "user",
        content: [
          { type: "text", text: "What do you see in this image?" },
          {
            type: "file",
            data: `data:image/png;base64,${base64Image}`,
            mediaType: "image/png",
          },
        ],
      },
    ],
  });

  console.log(text);
  console.log();
}

// Example 2: UI to code conversion
async function uiToCode() {
  console.log("=== Example 2: UI to Code ===\n");

  const base64Image =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  const { text } = await generateText({
    model: agent,
    prompt: [
      {
        role: "user",
        content: [
          { type: "text", text: "Implement this UI in React with Tailwind CSS" },
          {
            type: "file",
            data: `data:image/png;base64,${base64Image}`,
            mediaType: "image/png",
          },
        ],
      },
    ],
  });

  console.log(text);
  console.log();
}

// Example 3: Text extraction from image
async function textExtraction() {
  console.log("=== Example 3: Text Extraction ===\n");

  const base64Image =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  const { text } = await generateText({
    model: agent,
    prompt: [
      {
        role: "user",
        content: [
          { type: "text", text: "Extract all the text from this screenshot" },
          {
            type: "file",
            data: `data:image/png;base64,${base64Image}`,
            mediaType: "image/png",
          },
        ],
      },
    ],
  });

  console.log(text);
  console.log();
}

// Example 4: Streaming with partial vision analysis
async function streamingExample() {
  console.log("=== Example 4: Streaming with Vision Analysis ===\n");

  const base64Image =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  const { stream } = await streamText({
    model: agent,
    prompt: [
      {
        role: "user",
        content: [
          { type: "text", text: "Analyze this dashboard UI and suggest improvements" },
          {
            type: "file",
            data: `data:image/png;base64,${base64Image}`,
            mediaType: "image/png",
          },
        ],
      },
    ],
  });

  for await (const part of stream) {
    if (part.type === "text-delta") {
      process.stdout.write(part.delta);
    }
  }
  console.log("\n");
}

// Example 5: Error diagnosis
async function errorDiagnosis() {
  console.log("=== Example 5: Error Diagnosis ===\n");

  const base64Image =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  const { text } = await generateText({
    model: agent,
    prompt: [
      {
        role: "user",
        content: [
          { type: "text", text: "What's wrong with this code? I'm getting an error." },
          {
            type: "file",
            data: `data:image/png;base64,${base64Image}`,
            mediaType: "image/png",
          },
        ],
      },
    ],
  });

  console.log(text);
  console.log();
}

// Run examples
async function main() {
  console.log("=== Hybrid Agent Examples ===\n");

  try {
    await basicImageAnalysis();
    await uiToCode();
    await textExtraction();
    await streamingExample();
    await errorDiagnosis();
  } catch (error) {
    console.error("Error:", error);
  }
}

main().catch(console.error);
