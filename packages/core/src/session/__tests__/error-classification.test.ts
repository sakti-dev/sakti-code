import { classifyAgentError } from "@/session/error-classification";
import { describe, expect, it } from "vitest";

describe("classifyAgentError", () => {
  it("classifies UND_ERR_SOCKET as network_socket_closed", () => {
    const error = Object.assign(new Error("Cannot connect to API: other side closed"), {
      name: "AI_APICallError",
      isRetryable: true,
      cause: { code: "UND_ERR_SOCKET", message: "other side closed" },
    });

    const result = classifyAgentError(error);

    expect(result.kind).toBe("network_socket_closed");
    expect(result.retryable).toBe(true);
    expect(result.userMessage).toContain("connection dropped");
  });

  it("classifies 401 as auth", () => {
    const error = Object.assign(new Error("Unauthorized"), {
      name: "AI_APICallError",
      statusCode: 401,
      isRetryable: false,
    });

    const result = classifyAgentError(error);

    expect(result.kind).toBe("auth");
    expect(result.retryable).toBe(false);
  });

  it("classifies 429 as rate_limited", () => {
    const error = Object.assign(new Error("Rate limit exceeded"), {
      name: "AI_APICallError",
      statusCode: 429,
      isRetryable: true,
    });

    const result = classifyAgentError(error);

    expect(result.kind).toBe("rate_limited");
    expect(result.retryable).toBe(true);
  });
});
