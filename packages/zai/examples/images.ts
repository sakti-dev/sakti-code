/**
 * Vision/multimodal examples for @sakti-code/zai
 *
 * Run with:
 *   tsx examples/images.ts
 */

import { generateText } from "ai";
import { createZai } from "../src";

const zai = createZai({
  apiKey: process.env.ZAI_API_KEY,
});

// Example 1: Image from URL
async function imageUrlExample() {
  const { text } = await generateText({
    model: zai("glm-4.6v"),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "What do you see in this image?" },
          {
            type: "image",
            image: new URL("https://example.com/image.jpg"),
          },
        ],
      },
    ],
  });

  console.log("Image description:", text);
}

// Example 2: Base64 encoded image
async function base64ImageExample() {
  const base64Image =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

  const { text } = await generateText({
    model: zai("glm-4.6v"),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Describe this image" },
          {
            type: "image",
            image: new URL(`data:image/png;base64,${base64Image}`),
          },
        ],
      },
    ],
  });

  console.log("Description:", text);
}

// Example 3: Multiple images
async function multipleImagesExample() {
  const { text } = await generateText({
    model: zai("glm-4.6v"),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Compare these two images" },
          {
            type: "image",
            image: new URL("https://example.com/image1.jpg"),
          },
          {
            type: "image",
            image: new URL("https://example.com/image2.jpg"),
          },
        ],
      },
    ],
  });

  console.log("Comparison:", text);
}

// Example 4: Image with Uint8Array
async function uint8ArrayImageExample() {
  const imageBuffer = Buffer.from("fake-image-data");
  const uint8Array = new Uint8Array(imageBuffer);

  const { text } = await generateText({
    model: zai("glm-4.6v"),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "What is this?" },
          {
            type: "file",
            data: uint8Array,
            mimeType: "image/png",
          },
        ],
      },
    ],
  });

  console.log("Analysis:", text);
}

// Run examples
async function main() {
  console.log("=== Vision/Multimodal Examples ===\n");

  console.log("1. Image from URL:");
  await imageUrlExample();
  console.log("\n");

  console.log("2. Base64 encoded image:");
  await base64ImageExample();
  console.log("\n");

  console.log("3. Multiple images:");
  await multipleImagesExample();
  console.log("\n");

  console.log("4. Uint8Array image:");
  await uint8ArrayImageExample();
  console.log("\n");
}

main().catch(console.error);
