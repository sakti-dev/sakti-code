import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACCEPT_LANGUAGE,
  DEFAULT_CHINA_BASE_URL,
  DEFAULT_CODING_BASE_URL,
  DEFAULT_GENERAL_BASE_URL,
  DEFAULT_SOURCE_CHANNEL,
} from "../src/zai-constants";

describe("zai constants", () => {
  describe("base URLs", () => {
    it("should have correct general endpoint URL", () => {
      expect(DEFAULT_GENERAL_BASE_URL).toBe("https://api.z.ai/api/paas/v4");
    });

    it("should have correct coding endpoint URL", () => {
      expect(DEFAULT_CODING_BASE_URL).toBe("https://api.z.ai/api/coding/paas/v4");
    });

    it("should have correct China (Zhipu) endpoint URL", () => {
      expect(DEFAULT_CHINA_BASE_URL).toBe("https://open.bigmodel.cn/api/paas/v4");
    });
  });

  describe("default headers", () => {
    it("should have correct source channel", () => {
      expect(DEFAULT_SOURCE_CHANNEL).toBe("typescript-sdk");
    });

    it("should have correct accept language header", () => {
      expect(DEFAULT_ACCEPT_LANGUAGE).toBe("en-US,en");
    });
  });
});
