import { describe, expect, it } from "vitest";
import { inferModelCapabilities } from "../capabilities";

describe("inferModelCapabilities", () => {
  it("detects vision model ids", () => {
    const caps = inferModelCapabilities({
      providerId: "zai",
      modelId: "glm-4.6v",
      modelName: "GLM-4.6V",
    });

    expect(caps.vision).toBe(true);
    expect(caps.text).toBe(true);
  });

  it("detects planning-oriented model ids", () => {
    const caps = inferModelCapabilities({
      providerId: "zai",
      modelId: "zai-coding-plan",
      modelName: "Z.AI Coding Plan",
    });

    expect(caps.plan).toBe(true);
  });

  it("returns conservative defaults when unknown", () => {
    const caps = inferModelCapabilities({
      providerId: "openai",
      modelId: "gpt-x",
      modelName: "GPT-X",
    });

    expect(caps.text).toBe(true);
    expect(caps.tools).toBe(true);
    expect(caps.reasoning).toBe(true);
  });
});
