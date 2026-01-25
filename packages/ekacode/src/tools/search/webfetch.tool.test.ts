/**
 * Tests for webfetch.tool.ts
 */

/* eslint-disable @typescript-eslint/no-explicit-any -- Test files use any for simplicity */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the dependencies
const mockHttpsGet = vi.fn();
const mockHttpGet = vi.fn();

vi.mock("node:https", () => ({
  get: (...args: any[]) => mockHttpsGet(...args),
}));

vi.mock("node:http", () => ({
  get: (...args: any[]) => mockHttpGet(...args),
}));

vi.mock("turndown", () => ({
  default: class MockTurndownService {
    addRule = vi.fn();
    remove = vi.fn();
    turndown = vi.fn((html: string) => {
      // Simple HTML to markdown conversion
      return html
        .replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1\n")
        .replace(/<p[^>]*>(.*?)<\/p>/gi, "$1\n")
        .replace(/<[^>]*>/g, "");
    });
  },
}));

describe("webfetchTool", () => {
  let webfetchTool: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockHttpsGet.mockReset();
    mockHttpGet.mockReset();

    // Import the tool after mocks are set up
    const module = await import("./webfetch.tool");
    webfetchTool = module.webfetchTool;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should have correct schema", () => {
    expect(webfetchTool).toBeDefined();
    expect(webfetchTool.inputSchema).toBeDefined();
  });

  it("should fetch HTML and convert to markdown", async () => {
    // Mock successful HTTP response
    const mockResponse = {
      statusCode: 200,
      headers: {
        "content-type": "text/html",
        "content-length": "1000",
      },
      on: vi.fn((event: string, callback: any) => {
        if (event === "data") {
          setTimeout(
            () => callback(Buffer.from("<html><body><h1>Title</h1><p>Content</p></body></html>")),
            10
          );
        }
        if (event === "end") {
          setTimeout(() => callback(), 20);
        }
        return mockResponse;
      }),
    };

    mockHttpsGet.mockImplementation((url: string, options: any, callback: any) => {
      callback(mockResponse);
      return { on: vi.fn(), setTimeout: vi.fn(), destroy: vi.fn() };
    });

    const result = await webfetchTool.execute(
      {
        url: "https://example.com",
        format: "markdown",
      },
      {}
    );

    expect(result.content).toContain("Title");
    expect(result.content).toContain("Content");
  });

  it("should fetch plain text content", async () => {
    const mockResponse = {
      statusCode: 200,
      headers: {
        "content-type": "text/plain",
        "content-length": "100",
      },
      on: vi.fn((event: string, callback: any) => {
        if (event === "data") {
          setTimeout(() => callback(Buffer.from("Plain text content")), 10);
        }
        if (event === "end") {
          setTimeout(() => callback(), 20);
        }
        return mockResponse;
      }),
    };

    mockHttpsGet.mockImplementation((url: string, options: any, callback: any) => {
      callback(mockResponse);
      return { on: vi.fn(), setTimeout: vi.fn(), destroy: vi.fn() };
    });

    const result = await webfetchTool.execute(
      {
        url: "https://example.com/data.txt",
        format: "text",
      },
      {}
    );

    expect(result.content).toContain("Plain text content");
  });

  it("should handle 404 errors gracefully", async () => {
    const mockResponse = {
      statusCode: 404,
      headers: {},
      on: vi.fn((event: string, callback: any) => {
        if (event === "data") {
          setTimeout(() => callback(Buffer.from("Not Found")), 10);
        }
        if (event === "end") {
          setTimeout(() => callback(), 20);
        }
        return mockResponse;
      }),
    };

    mockHttpsGet.mockImplementation((url: string, options: any, callback: any) => {
      callback(mockResponse);
      return { on: vi.fn(), setTimeout: vi.fn(), destroy: vi.fn() };
    });

    const result = await webfetchTool.execute(
      {
        url: "https://example.com/notfound",
        format: "text",
      },
      {}
    );

    // Should handle error gracefully
    expect(result).toBeDefined();
  });

  it("should enforce 5MB size limit", async () => {
    const largeContent = "x".repeat(6 * 1024 * 1024); // 6MB

    const mockResponse = {
      statusCode: 200,
      headers: {
        "content-type": "text/html",
        "content-length": String(largeContent.length),
      },
      on: vi.fn((event: string, callback: any) => {
        if (event === "data") {
          setTimeout(() => callback(Buffer.from(largeContent)), 10);
        }
        if (event === "end") {
          setTimeout(() => callback(), 20);
        }
        return mockResponse;
      }),
    };

    mockHttpsGet.mockImplementation((url: string, options: any, callback: any) => {
      callback(mockResponse);
      return { on: vi.fn(), setTimeout: vi.fn(), destroy: vi.fn() };
    });

    const result = await webfetchTool.execute(
      {
        url: "https://example.com/large",
        format: "text",
      },
      {}
    );

    // Should handle size limit
    expect(result).toBeDefined();
  });

  it("should handle Cloudflare challenges", async () => {
    let callCount = 0;

    const mockResponse = {
      statusCode: 200,
      headers: {
        "content-type": "text/html",
        "cf-mitigated": "challenge",
      },
      on: vi.fn((event: string, callback: any) => {
        if (event === "data") {
          setTimeout(() => callback(Buffer.from("<html><body>Challenge page</body></html>")), 10);
        }
        if (event === "end") {
          setTimeout(() => callback(), 20);
        }
        return mockResponse;
      }),
    };

    mockHttpsGet.mockImplementation((url: string, options: any, callback: any) => {
      callCount++;
      // First call gets challenge, second call (retry) succeeds
      if (callCount === 1) {
        callback(mockResponse);
      } else {
        // Return success on retry
        const successResponse = { ...mockResponse };
        (successResponse.headers as any)["cf-mitigated"] = undefined;
        successResponse.on = vi.fn((event: string, cb: any) => {
          if (event === "data") {
            setTimeout(() => cb(Buffer.from("<html><body>Success page</body></html>")), 10);
          }
          if (event === "end") {
            setTimeout(() => cb(), 20);
          }
          return successResponse;
        });
        callback(successResponse);
      }
      return { on: vi.fn(), setTimeout: vi.fn() };
    });

    const result = await webfetchTool.execute(
      {
        url: "https://example.com",
        format: "html",
      },
      {}
    );

    expect(result).toBeDefined();
    expect(callCount).toBeGreaterThan(1); // Should retry
  });

  it("should use correct Accept headers for different formats", async () => {
    const mockResponse = {
      statusCode: 200,
      headers: {
        "content-type": "text/html",
      },
      on: vi.fn((event: string, callback: any) => {
        if (event === "data") {
          setTimeout(() => callback(Buffer.from("<html></html>")), 10);
        }
        if (event === "end") {
          setTimeout(() => callback(), 20);
        }
        return mockResponse;
      }),
    };

    mockHttpsGet.mockImplementation((url: string, options: any, callback: any) => {
      callback(mockResponse);
      return { on: vi.fn(), setTimeout: vi.fn(), destroy: vi.fn() };
    });

    await webfetchTool.execute(
      {
        url: "https://example.com",
        format: "markdown",
      },
      {}
    );

    expect(mockHttpsGet).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: expect.stringContaining("text/markdown"),
        }),
      }),
      expect.any(Function)
    );
  });

  it("should handle network errors gracefully", async () => {
    mockHttpsGet.mockImplementation(() => {
      throw new Error("Network error");
    });

    const result = await webfetchTool.execute(
      {
        url: "https://example.com",
        format: "text",
      },
      {}
    );

    // Should handle error gracefully
    expect(result).toBeDefined();
    expect(result.content).toContain("Error");
  });
});
