import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createZai } from "./zai-provider";

vi.mock("./version", () => ({
  VERSION: "0.0.0-test",
}));

describe("createZai", () => {
  describe("provider factory", () => {
    it("should create a provider with specification version v3", () => {
      const provider = createZai({ apiKey: "test-api-key" });
      expect(provider.specificationVersion).toBe("v3");
    });

    it("should have chat method as function", () => {
      const provider = createZai({ apiKey: "test-api-key" });
      expect(typeof provider.chat).toBe("function");
    });

    it("should have languageModel method as function", () => {
      const provider = createZai({ apiKey: "test-api-key" });
      expect(typeof provider.languageModel).toBe("function");
    });

    it("should be callable as a function", () => {
      const provider = createZai({ apiKey: "test-api-key" });
      expect(typeof provider).toBe("function");
    });
  });

  describe("endpoint configuration", () => {
    const originalBaseUrl = process.env.ZAI_BASE_URL;

    beforeEach(() => {
      vi.restoreAllMocks();
    });

    afterEach(() => {
      if (originalBaseUrl === undefined) {
        delete process.env.ZAI_BASE_URL;
      } else {
        process.env.ZAI_BASE_URL = originalBaseUrl;
      }
    });

    it("should use general endpoint by default", () => {
      delete process.env.ZAI_BASE_URL;

      const provider = createZai({ apiKey: "test-api-key" });
      const model = provider("glm-4.7");

      expect(model.provider).toBe("zai.chat");
    });

    it("should use coding endpoint when specified", () => {
      const provider = createZai({
        apiKey: "test-api-key",
        endpoint: "coding",
      });
      const model = provider("glm-4.7");

      expect(model.provider).toBe("zai.chat");
    });

    it("should prefer baseURL option over endpoint", () => {
      const provider = createZai({
        apiKey: "test-api-key",
        endpoint: "coding",
        baseURL: "https://custom.z.ai/v1",
      });
      const model = provider("glm-4.7");

      expect(model.provider).toBe("zai.chat");
    });
  });

  describe("model IDs", () => {
    it("should accept glm-4.7 model ID", () => {
      const provider = createZai({ apiKey: "test-api-key" });
      const model = provider("glm-4.7");
      expect(model).toBeDefined();
    });

    it("should accept glm-4.7-flash model ID", () => {
      const provider = createZai({ apiKey: "test-api-key" });
      const model = provider("glm-4.7-flash");
      expect(model).toBeDefined();
    });

    it("should accept glm-4.6 model ID", () => {
      const provider = createZai({ apiKey: "test-api-key" });
      const model = provider("glm-4.6");
      expect(model).toBeDefined();
    });

    it("should accept glm-4.6v model ID", () => {
      const provider = createZai({ apiKey: "test-api-key" });
      const model = provider("glm-4.6v");
      expect(model).toBeDefined();
    });
  });
});
