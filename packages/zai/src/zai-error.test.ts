import { safeParseJSON } from "@ai-sdk/provider-utils";
import { describe, expect, it } from "vitest";
import { zaiErrorDataSchema } from "./zai-error";

describe("zaiErrorDataSchema", () => {
  it("should parse standard Z.ai error response", async () => {
    const error = `{"error":{"message":"Invalid API key","code":401}}`;

    const result = await safeParseJSON({
      text: error,
      schema: zaiErrorDataSchema,
    });

    expect(result).toStrictEqual({
      success: true,
      value: {
        error: {
          message: "Invalid API key",
          code: 401,
        },
      },
      rawValue: {
        error: {
          message: "Invalid API key",
          code: 401,
        },
      },
    });
  });

  it("should parse Z.ai error with type field", async () => {
    const error = `{"error":{"message":"Rate limit exceeded","code":429,"type":"rate_limit_error"}}`;

    const result = await safeParseJSON({
      text: error,
      schema: zaiErrorDataSchema,
    });

    expect(result).toStrictEqual({
      success: true,
      value: {
        error: {
          message: "Rate limit exceeded",
          code: 429,
          type: "rate_limit_error",
        },
      },
      rawValue: {
        error: {
          message: "Rate limit exceeded",
          code: 429,
          type: "rate_limit_error",
        },
      },
    });
  });

  it("should parse Z.ai error with string code", async () => {
    const error = `{"error":{"message":"Invalid request","code":"invalid_request"}}`;

    const result = await safeParseJSON({
      text: error,
      schema: zaiErrorDataSchema,
    });

    expect(result).toStrictEqual({
      success: true,
      value: {
        error: {
          message: "Invalid request",
          code: "invalid_request",
        },
      },
      rawValue: {
        error: {
          message: "Invalid request",
          code: "invalid_request",
        },
      },
    });
  });

  it("should parse minimal Z.ai error with only message", async () => {
    const error = `{"error":{"message":"An error occurred"}}`;

    const result = await safeParseJSON({
      text: error,
      schema: zaiErrorDataSchema,
    });

    expect(result).toStrictEqual({
      success: true,
      value: {
        error: {
          message: "An error occurred",
        },
      },
      rawValue: {
        error: {
          message: "An error occurred",
        },
      },
    });
  });

  it("should parse Z.ai error with param field", async () => {
    const error = `{"error":{"message":"Invalid model ID","param":"model"}}`;

    const result = await safeParseJSON({
      text: error,
      schema: zaiErrorDataSchema,
    });

    expect(result).toStrictEqual({
      success: true,
      value: {
        error: {
          message: "Invalid model ID",
          param: "model",
        },
      },
      rawValue: {
        error: {
          message: "Invalid model ID",
          param: "model",
        },
      },
    });
  });

  it("should parse complex Z.ai error with all fields", async () => {
    const error = `{"error":{"message":"Request validation failed","code":400,"type":"invalid_request_error","param":"temperature"}}`;

    const result = await safeParseJSON({
      text: error,
      schema: zaiErrorDataSchema,
    });

    expect(result).toStrictEqual({
      success: true,
      value: {
        error: {
          message: "Request validation failed",
          code: 400,
          type: "invalid_request_error",
          param: "temperature",
        },
      },
      rawValue: {
        error: {
          message: "Request validation failed",
          code: 400,
          type: "invalid_request_error",
          param: "temperature",
        },
      },
    });
  });
});
