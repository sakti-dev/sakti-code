/**
 * Spec Phase Tools - Tests
 *
 * T-011 - Implement spec phase tools and lifecycle transitions
 *
 * Tests for spec phase tools existence and structure
 */

import { describe, expect, it } from "vitest";
import { getToolsForPhase } from "../phase-tools";
import { toolRegistry, type ToolName } from "../registry";

describe("spec phase tools registration", () => {
  it("should register spec-init tool", () => {
    expect(toolRegistry).toHaveProperty("spec-init");
  });

  it("should register spec-requirements tool", () => {
    expect(toolRegistry).toHaveProperty("spec-requirements");
  });

  it("should register spec-design tool", () => {
    expect(toolRegistry).toHaveProperty("spec-design");
  });

  it("should register spec-tasks tool", () => {
    expect(toolRegistry).toHaveProperty("spec-tasks");
  });

  it("should register spec-status tool", () => {
    expect(toolRegistry).toHaveProperty("spec-status");
  });

  it("should register spec-quick tool", () => {
    expect(toolRegistry).toHaveProperty("spec-quick");
  });
});

describe("spec phase tools in plan phase", () => {
  it("should include spec-init in plan phase tools", () => {
    const planTools = getToolsForPhase("plan");
    expect(planTools).toHaveProperty("spec-init");
  });

  it("should include spec-requirements in plan phase tools", () => {
    const planTools = getToolsForPhase("plan");
    expect(planTools).toHaveProperty("spec-requirements");
  });

  it("should include spec-design in plan phase tools", () => {
    const planTools = getToolsForPhase("plan");
    expect(planTools).toHaveProperty("spec-design");
  });

  it("should include spec-tasks in plan phase tools", () => {
    const planTools = getToolsForPhase("plan");
    expect(planTools).toHaveProperty("spec-tasks");
  });

  it("should include spec-status in plan phase tools", () => {
    const planTools = getToolsForPhase("plan");
    expect(planTools).toHaveProperty("spec-status");
  });

  it("should include spec-quick in plan phase tools", () => {
    const planTools = getToolsForPhase("plan");
    expect(planTools).toHaveProperty("spec-quick");
  });
});

describe("spec phase tools in build phase", () => {
  it("should include spec-init in build phase tools", () => {
    const buildTools = getToolsForPhase("build");
    expect(buildTools).toHaveProperty("spec-init");
  });

  it("should include spec-requirements in build phase tools", () => {
    const buildTools = getToolsForPhase("build");
    expect(buildTools).toHaveProperty("spec-requirements");
  });

  it("should include spec-design in build phase tools", () => {
    const buildTools = getToolsForPhase("build");
    expect(buildTools).toHaveProperty("spec-design");
  });

  it("should include spec-tasks in build phase tools", () => {
    const buildTools = getToolsForPhase("build");
    expect(buildTools).toHaveProperty("spec-tasks");
  });

  it("should include spec-status in build phase tools", () => {
    const buildTools = getToolsForPhase("build");
    expect(buildTools).toHaveProperty("spec-status");
  });

  it("should include spec-quick in build phase tools", () => {
    const buildTools = getToolsForPhase("build");
    expect(buildTools).toHaveProperty("spec-quick");
  });
});

describe("spec phase tools in explore phase", () => {
  it("should not include spec-init in explore phase tools", () => {
    const exploreTools = getToolsForPhase("explore");
    expect(exploreTools).not.toHaveProperty("spec-init");
  });

  it("should not include spec-requirements in explore phase tools", () => {
    const exploreTools = getToolsForPhase("explore");
    expect(exploreTools).not.toHaveProperty("spec-requirements");
  });

  it("should not include spec-design in explore phase tools", () => {
    const exploreTools = getToolsForPhase("explore");
    expect(exploreTools).not.toHaveProperty("spec-design");
  });

  it("should not include spec-tasks in explore phase tools", () => {
    const exploreTools = getToolsForPhase("explore");
    expect(exploreTools).not.toHaveProperty("spec-tasks");
  });

  it("should not include spec-status in explore phase tools", () => {
    const exploreTools = getToolsForPhase("explore");
    expect(exploreTools).not.toHaveProperty("spec-status");
  });

  it("should not include spec-quick in explore phase tools", () => {
    const exploreTools = getToolsForPhase("explore");
    expect(exploreTools).not.toHaveProperty("spec-quick");
  });
});

describe("ToolName type includes spec tools", () => {
  it("should include spec-init in ToolName union", () => {
    const toolName: ToolName = "spec-init";
    expect(toolName).toBe("spec-init");
  });

  it("should include spec-requirements in ToolName union", () => {
    const toolName: ToolName = "spec-requirements";
    expect(toolName).toBe("spec-requirements");
  });

  it("should include spec-design in ToolName union", () => {
    const toolName: ToolName = "spec-design";
    expect(toolName).toBe("spec-design");
  });

  it("should include spec-tasks in ToolName union", () => {
    const toolName: ToolName = "spec-tasks";
    expect(toolName).toBe("spec-tasks");
  });

  it("should include spec-status in ToolName union", () => {
    const toolName: ToolName = "spec-status";
    expect(toolName).toBe("spec-status");
  });

  it("should include spec-quick in ToolName union", () => {
    const toolName: ToolName = "spec-quick";
    expect(toolName).toBe("spec-quick");
  });
});
