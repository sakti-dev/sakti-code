import type { LanguageModelV4Prompt } from "@ai-sdk/provider";
import { describe, expect, it } from "vitest";
import { convertToZaiMessages } from "../convert-to-zai-messages.ts";

describe("convertToZaiMessages", () => {
  it("lifts system to top-level", () => {
    const { system, messages } = convertToZaiMessages({
      prompt: [
        { role: "system", content: "you are helpful" },
        { role: "user", content: [{ type: "text", text: "hi" }] },
      ] as LanguageModelV4Prompt,
    });
    expect(system?.[0]).toMatchObject({
      type: "text",
      text: "you are helpful",
    });
    expect(messages[0]!.role).toBe("user");
  });

  it("emits tool_result from a tool role message", () => {
    const { messages } = convertToZaiMessages({
      prompt: [
        { role: "user", content: [{ type: "text", text: "q" }] },
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "tu_1",
              toolName: "Read",
              output: { type: "text", value: "file contents" },
            },
          ],
        },
      ] as LanguageModelV4Prompt,
    });
    // user + tool messages are merged into a single user turn (Anthropic protocol)
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe("user");
    expect(messages[0]!.content[1]).toMatchObject({
      type: "tool_result",
      tool_use_id: "tu_1",
      content: "file contents",
    });
  });

  it("replays assistant reasoning with signature", () => {
    const { messages } = convertToZaiMessages({
      prompt: [
        {
          role: "assistant",
          content: [
            {
              type: "reasoning",
              text: "hmm",
              providerOptions: { zai: { signature: "sig" } },
            },
            { type: "text", text: "ans" },
          ],
        },
      ] as LanguageModelV4Prompt,
    });
    expect(messages[0]!.content[0]).toMatchObject({
      type: "thinking",
      thinking: "hmm",
      signature: "sig",
    });
  });

  it("replays assistant reasoning from anthropic.signature (back-compat)", () => {
    const { messages } = convertToZaiMessages({
      prompt: [
        {
          role: "assistant",
          content: [
            {
              type: "reasoning",
              text: "hmm",
              providerOptions: { anthropic: { signature: "sig" } },
            },
          ],
        },
      ] as LanguageModelV4Prompt,
    });
    expect(messages[0]!.content[0]).toMatchObject({
      type: "thinking",
      thinking: "hmm",
      signature: "sig",
    });
  });

  it("drops reasoning when sendReasoning is false", () => {
    const { messages } = convertToZaiMessages({
      prompt: [
        {
          role: "assistant",
          content: [
            {
              type: "reasoning",
              text: "hmm",
              providerOptions: { zai: { signature: "sig" } },
            },
            { type: "text", text: "ans" },
          ],
        },
      ] as LanguageModelV4Prompt,
      sendReasoning: false,
    });
    expect(messages[0]!.content).toHaveLength(1);
    expect(messages[0]!.content[0]).toMatchObject({
      type: "text",
      text: "ans",
    });
  });

  it("emits tool_use from assistant tool-call part", () => {
    const { messages } = convertToZaiMessages({
      prompt: [
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "tu_1",
              toolName: "Read",
              input: { path: "a.ts" },
            },
          ],
        },
      ] as LanguageModelV4Prompt,
    });
    expect(messages[0]!.content[0]).toMatchObject({
      type: "tool_use",
      id: "tu_1",
      name: "Read",
      input: { path: "a.ts" },
    });
  });

  it("emits image block from user file part", () => {
    const { messages } = convertToZaiMessages({
      prompt: [
        {
          role: "user",
          content: [
            {
              type: "file",
              mediaType: "image/png",
              data: { type: "data", data: "aGVsbG8=" },
            },
          ],
        },
      ] as LanguageModelV4Prompt,
    });
    expect(messages[0]!.content[0]).toMatchObject({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: "aGVsbG8=",
      },
    });
  });

  it("marks tool_result as is_error when output is error-text", () => {
    const { messages } = convertToZaiMessages({
      prompt: [
        {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "tu_1",
              toolName: "Read",
              output: { type: "error-text", value: "boom" },
            },
          ],
        },
      ] as LanguageModelV4Prompt,
    });
    expect(messages[0]!.content[0]).toMatchObject({
      type: "tool_result",
      is_error: true,
      content: "boom",
    });
  });
});
