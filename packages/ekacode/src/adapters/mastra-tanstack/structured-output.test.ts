/**
 * Tests for structured-output.ts - Provider capability detection and JSON parsing
 */

import { describe, expect, it } from "vitest";
import {
  detectProviderSupport,
  parseJSONWithFallbacks,
  transformSchemaForOpenAI,
} from "./structured-output";
import { StructuredOutputSupport } from "./types";

describe("detectProviderSupport", () => {
  it("should detect OpenAI provider capabilities", () => {
    const result = detectProviderSupport("openai/gpt-4o", "gpt-4o");

    expect(result.providerId).toBe("openai");
    expect(result.modelId).toBe("gpt-4o");
    expect(result.structuredOutput).toBe(StructuredOutputSupport.NATIVE_JSON_SCHEMA);
    expect(result.supportsTools).toBe(true);
    expect(result.supportsStreaming).toBe(true);
    expect(result.supportsImages).toBe(true);
  });

  it("should detect Anthropic provider capabilities", () => {
    const result = detectProviderSupport("anthropic/claude-3-5-sonnet", "claude-3-5-sonnet");

    expect(result.providerId).toBe("anthropic");
    expect(result.structuredOutput).toBe(StructuredOutputSupport.TOOL_BASED);
    expect(result.supportsTools).toBe(true);
    expect(result.supportsStreaming).toBe(true);
    expect(result.supportsImages).toBe(true);
  });

  it("should detect Google provider capabilities", () => {
    const result = detectProviderSupport("google/gemini-2.0-flash", "gemini-2.0-flash");

    expect(result.providerId).toBe("google");
    expect(result.structuredOutput).toBe(StructuredOutputSupport.NATIVE_JSON_SCHEMA);
    expect(result.supportsTools).toBe(true);
    expect(result.supportsStreaming).toBe(true);
    expect(result.supportsImages).toBe(true);
  });

  it("should detect Mistral provider capabilities", () => {
    const result = detectProviderSupport("mistral/mistral-large", "mistral-large");

    expect(result.providerId).toBe("mistral");
    expect(result.structuredOutput).toBe(StructuredOutputSupport.TOOL_BASED);
    expect(result.supportsTools).toBe(true);
    expect(result.supportsStreaming).toBe(true);
    expect(result.supportsImages).toBe(false);
  });

  it("should detect Cohere provider capabilities", () => {
    const result = detectProviderSupport("cohere/command-r-plus", "command-r-plus");

    expect(result.providerId).toBe("cohere");
    expect(result.structuredOutput).toBe(StructuredOutputSupport.TOOL_BASED);
    expect(result.supportsTools).toBe(true);
    expect(result.supportsStreaming).toBe(true);
    expect(result.supportsImages).toBe(false);
  });

  it("should handle unknown providers with fallback", () => {
    const result = detectProviderSupport("unknown/model-x", "model-x");

    expect(result.providerId).toBe("unknown");
    expect(result.structuredOutput).toBe(StructuredOutputSupport.INSTRUCTION_ONLY);
    expect(result.supportsTools).toBe(false);
    expect(result.supportsStreaming).toBe(true);
    expect(result.supportsImages).toBe(false);
  });

  it("should normalize provider IDs with path separators", () => {
    const result = detectProviderSupport("openai/models/gpt-4o", "gpt-4o");

    expect(result.providerId).toBe("openai");
    expect(result.structuredOutput).toBe(StructuredOutputSupport.NATIVE_JSON_SCHEMA);
  });

  it("should handle case-insensitive provider names", () => {
    const result = detectProviderSupport("OPENAI/GPT-4O", "gpt-4o");

    expect(result.providerId).toBe("openai");
    expect(result.structuredOutput).toBe(StructuredOutputSupport.NATIVE_JSON_SCHEMA);
  });
});

describe("parseJSONWithFallbacks", () => {
  it("should parse direct JSON", () => {
    const result = parseJSONWithFallbacks('{"name":"test","value":123}');

    expect(result).toEqual({ name: "test", value: 123 });
  });

  it("should parse JSON with whitespace", () => {
    const result = parseJSONWithFallbacks('  { "name" : "test" , "value" : 123 }  ');

    expect(result).toEqual({ name: "test", value: 123 });
  });

  it("should extract JSON from markdown code blocks", () => {
    const text = '```json\n{"name":"test","value":123}\n```';
    const result = parseJSONWithFallbacks(text);

    expect(result).toEqual({ name: "test", value: 123 });
  });

  it("should extract JSON from code blocks without language tag", () => {
    const text = '```\n{"name":"test","value":123}\n```';
    const result = parseJSONWithFallbacks(text);

    expect(result).toEqual({ name: "test", value: 123 });
  });

  it("should extract JSON from mixed content", () => {
    const text = 'Some text before {"name":"test"} and after';
    const result = parseJSONWithFallbacks(text);

    expect(result).toEqual({ name: "test" });
  });

  it("should parse arrays", () => {
    const result = parseJSONWithFallbacks('[{"name":"test"},{"name":"test2"}]');

    expect(result).toEqual([{ name: "test" }, { name: "test2" }]);
  });

  it("should throw error for empty text", () => {
    expect(() => parseJSONWithFallbacks("")).toThrow("Empty text provided");
  });

  it("should throw error for text with no valid JSON", () => {
    expect(() => parseJSONWithFallbacks("This is just plain text with no JSON")).toThrow(
      "No valid JSON found"
    );
  });
});

describe("transformSchemaForOpenAI", () => {
  it("should make all properties required", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
      },
    };

    const result = transformSchemaForOpenAI(schema);

    expect(result.required).toEqual(["name", "age"]);
  });

  it("should set additionalProperties to false", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string" },
      },
    };

    const result = transformSchemaForOpenAI(schema);

    expect(result.additionalProperties).toBe(false);
  });

  it("should preserve other schema properties", () => {
    const schema = {
      type: "object",
      properties: {
        name: { type: "string" },
      },
      title: "TestSchema",
    };

    const result = transformSchemaForOpenAI(schema);

    expect(result.title).toBe("TestSchema");
    expect(result.type).toBe("object");
  });

  it("should handle empty properties", () => {
    const schema = {
      type: "object",
      properties: {},
    };

    const result = transformSchemaForOpenAI(schema);

    expect(result.required).toEqual([]);
    expect(result.additionalProperties).toBe(false);
  });

  it("should handle schema without properties", () => {
    const schema = {
      type: "object",
    };

    const result = transformSchemaForOpenAI(schema);

    expect(result.additionalProperties).toBe(false);
    expect(result.required).toBeUndefined();
  });
});
