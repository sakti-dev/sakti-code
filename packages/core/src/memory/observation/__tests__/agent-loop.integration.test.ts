/**
 * Tests for Agent Loop Integration - TDD
 *
 * Tests verify:
 * - Automatic mode detection from agent type
 * - Integration of processInputStep in agent execution
 * - Observation injection into message list
 * - Mode-specific observer prompts
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const testHomeDir = `/tmp/sakti-code-test-agent-loop-${Date.now()}`;
const previousSaktiCodeHome = process.env.SAKTI_CODE_HOME;

beforeEach(() => {
  process.env.SAKTI_CODE_HOME = testHomeDir;
});

afterEach(async () => {
  if (previousSaktiCodeHome === undefined) {
    delete process.env.SAKTI_CODE_HOME;
  } else {
    process.env.SAKTI_CODE_HOME = previousSaktiCodeHome;
  }
});

describe("Agent Loop Integration - Mode Detection", () => {
  describe("getAgentMode", () => {
    it("should return 'explore' for explore agent type", async () => {
      const { getAgentMode } = await import("@/memory/observation/orchestration");
      expect(getAgentMode("explore")).toBe("explore");
    });

    it("should return 'default' for build agent type", async () => {
      const { getAgentMode } = await import("@/memory/observation/orchestration");
      expect(getAgentMode("build")).toBe("default");
    });

    it("should return 'default' for plan agent type", async () => {
      const { getAgentMode } = await import("@/memory/observation/orchestration");
      expect(getAgentMode("plan")).toBe("default");
    });

    it("should return 'default' for unknown agent type", async () => {
      const { getAgentMode } = await import("@/memory/observation/orchestration");
      expect(getAgentMode("unknown")).toBe("default");
    });

    it("should return 'bug_fixing' for bug_fixing agent type", async () => {
      const { getAgentMode } = await import("@/memory/observation/orchestration");
      expect(getAgentMode("bug_fixing")).toBe("bug_fixing");
    });

    it("should return 'refactoring' for refactoring agent type", async () => {
      const { getAgentMode } = await import("@/memory/observation/orchestration");
      expect(getAgentMode("refactoring")).toBe("refactoring");
    });

    it("should return 'testing' for testing agent type", async () => {
      const { getAgentMode } = await import("@/memory/observation/orchestration");
      expect(getAgentMode("testing")).toBe("testing");
    });

    it("should return 'debugging' for debugging agent type", async () => {
      const { getAgentMode } = await import("@/memory/observation/orchestration");
      expect(getAgentMode("debugging")).toBe("debugging");
    });

    it("should return 'research' for research agent type", async () => {
      const { getAgentMode } = await import("@/memory/observation/orchestration");
      expect(getAgentMode("research")).toBe("research");
    });
  });

  describe("buildObserverPromptForMode", () => {
    it("should build different prompts for different modes", async () => {
      const { buildObserverPromptForMode } = await import("@/memory/observation/orchestration");

      const explorePrompt = buildObserverPromptForMode("explore");
      const defaultPrompt = buildObserverPromptForMode("default");

      // Explore mode should mention exploration focus
      expect(explorePrompt).toContain("EXPLORE");
      // Default mode should not have exploration-specific instructions
      expect(defaultPrompt).toContain("DEFAULT");
    });

    it("should include extraction instructions in prompt", async () => {
      const { buildObserverPromptForMode } = await import("@/memory/observation/orchestration");

      const prompt = buildObserverPromptForMode("default");
      expect(prompt).toContain("EXTRACTION INSTRUCTIONS");
    });

    it("should include output format in prompt", async () => {
      const { buildObserverPromptForMode } = await import("@/memory/observation/orchestration");

      const prompt = buildObserverPromptForMode("default");
      expect(prompt).toContain("OUTPUT FORMAT");
    });
  });
});

describe("Agent Loop Integration - Process Input Step", () => {
  beforeEach(async () => {
    const { closeDb, getDb } = await import("@/testing/db");
    closeDb();
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    await db.run(sql`DELETE FROM observational_memory`);
  });

  afterEach(async () => {
    const { closeDb } = await import("@/testing/db");
    closeDb();
  });

  it("should create observer agent function with mode-specific prompts", async () => {
    const { createObserverAgent } = await import("@/memory/observation/orchestration");
    const { getModelByReference } = await import("@/agent/workflow/model-provider");

    const model = getModelByReference("openai/gpt-4o-mini");
    const observerAgent = createObserverAgent(model, "explore");

    // Should be a function
    expect(typeof observerAgent).toBe("function");
  });

  it("should accept AgentConfig and detect mode automatically", async () => {
    const { createObserverAgentFromConfig } = await import("@/memory/observation/orchestration");
    const { getModelByReference } = await import("@/agent/workflow/model-provider");

    const model = getModelByReference("openai/gpt-4o-mini");

    const config = {
      id: "test-agent",
      type: "explore" as const,
      model: "openai/gpt-4o-mini",
    };

    const observerAgent = createObserverAgentFromConfig(model, config);

    expect(typeof observerAgent).toBe("function");
  });
});

describe("Agent Loop Integration - Observation Injection", () => {
  beforeEach(async () => {
    const { closeDb, getDb } = await import("@/testing/db");
    closeDb();
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    await db.run(sql`DELETE FROM observational_memory`);
  });

  afterEach(async () => {
    const { closeDb } = await import("@/testing/db");
    closeDb();
  });

  it("should format observations for injection", async () => {
    const { formatObservationsForInjection } = await import("@/memory/observation/orchestration");

    const observations = `
🔴 14:30 Created Login Zod schema with email, password fields
🟢 14:35 Added validation for password min 8 chars
    `.trim();

    const formatted = formatObservationsForInjection(observations);

    expect(formatted).toContain("<observations>");
    expect(formatted).toContain("🔴 14:30");
    expect(formatted).toContain("Login Zod schema");
  });

  it("should return empty string when no observations", async () => {
    const { formatObservationsForInjection } = await import("@/memory/observation/orchestration");

    const formatted = formatObservationsForInjection("");

    expect(formatted).toBe("");
  });
});
