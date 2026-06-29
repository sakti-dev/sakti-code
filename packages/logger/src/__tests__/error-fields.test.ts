import { describe, expect, it } from "vite-plus/test";
import { extractErrorFields } from "../error-fields.ts";

describe("extractErrorFields", () => {
  it("returns empty object for undefined", () => {
    expect(extractErrorFields(undefined)).toEqual({});
  });

  it("returns empty object for non-error primitives", () => {
    expect(extractErrorFields("oops")).toEqual({});
    expect(extractErrorFields(42)).toEqual({});
  });

  it("extracts name and message from a plain Error", () => {
    const err = new Error("boom");
    const fields = extractErrorFields(err);
    expect(fields.name).toBe("Error");
    expect(fields.message).toBe("boom");
  });

  it("extracts AI SDK APICallError fields (statusCode, responseBody, url, responseHeaders, isRetryable)", () => {
    const err = Object.assign(new Error("Upstream request failed"), {
      name: "AI_APICallError",
      url: "https://opencode.ai/zen/v1/chat/completions",
      statusCode: 502,
      responseBody: '{"error":"upstream down"}',
      responseHeaders: {
        "content-type": "application/json",
        "x-request-id": "abc",
      },
      isRetryable: true,
      requestBodyValues: { model: "deepseek-v4-flash-free", messages: [] },
    });

    const fields = extractErrorFields(err);

    expect(fields.name).toBe("AI_APICallError");
    expect(fields.message).toBe("Upstream request failed");
    expect(fields.url).toBe("https://opencode.ai/zen/v1/chat/completions");
    expect(fields.statusCode).toBe(502);
    expect(fields.responseBody).toBe('{"error":"upstream down"}');
    expect(fields.responseHeaders).toEqual({
      "content-type": "application/json",
      "x-request-id": "abc",
    });
    expect(fields.isRetryable).toBe(true);
    // requestBodyValues is intentionally excluded (large + may carry secrets).
    expect(fields.requestBodyValues).toBeUndefined();
  });

  it("describes a nested cause recursively", () => {
    const root = Object.assign(new Error("inner failure"), {
      name: "AI_APICallError",
      statusCode: 500,
    });
    const wrapped = new Error("outer", { cause: root });

    const fields = extractErrorFields(wrapped);

    expect(fields.message).toBe("outer");
    expect(fields.cause).toBe("inner failure");
  });

  it("captures a numeric status / data fields when present", () => {
    const err = Object.assign(new Error("nope"), {
      status: 429,
      data: { reason: "rate_limited" },
    });

    const fields = extractErrorFields(err);

    expect(fields.status).toBe(429);
    expect(fields.data).toEqual({ reason: "rate_limited" });
  });

  it("does not throw on a non-enumerable / malformed error", () => {
    const weird = Object.create(null);
    Object.setPrototypeOf(weird, Error.prototype);
    (weird as { message?: string }).message = "weird";
    expect(() => extractErrorFields(weird as Error)).not.toThrow();
  });
});
