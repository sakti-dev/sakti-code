import { describe, expect, it } from "vitest";
import { loadAgents } from "../../harness/agents.ts";
import type { AgentDefinition } from "../../harness/types.ts";
import { createTempDir } from "./session-test-utils.ts";
import { TestExecutionEnv } from "./test-execution-env.ts";

describe("loadAgents", () => {
  it("loads .md under agent/ and agents/ as agent definitions named by path", async () => {
    const root = createTempDir();
    const env = new TestExecutionEnv(root);
    await env.createDir(".agents/agent", { recursive: true });
    await env.createDir(".agents/agents/team", { recursive: true });
    await env.writeFile(
      ".agents/agent/triage.md",
      "---\nmode: primary\nhidden: true\ndescription: triage agent\n---\nYou triage issues."
    );
    await env.writeFile(
      ".agents/agents/team/research.md",
      "---\ndescription: research\n---\nYou research."
    );

    const { agents, diagnostics } = await loadAgents(env, [".agents"]);

    expect(diagnostics).toEqual([]);
    const expected: AgentDefinition[] = [
      {
        name: "team/research",
        mode: "all",
        description: "research",
        systemPrompt: "You research.",
      },
      {
        name: "triage",
        mode: "primary",
        hidden: true,
        description: "triage agent",
        systemPrompt: "You triage issues.",
      },
    ];
    expect(agents).toEqual(expected);
  });

  it("returns no agents when no agent/ or agents/ subtree exists", async () => {
    const root = createTempDir();
    const env = new TestExecutionEnv(root);
    await env.createDir(".agents/commands", { recursive: true });

    const { agents, diagnostics } = await loadAgents(env, [".agents"]);

    expect(agents).toEqual([]);
    expect(diagnostics).toEqual([]);
  });

  it("parses a provider/model string into providerId and modelId", async () => {
    const root = createTempDir();
    const env = new TestExecutionEnv(root);
    await env.createDir(".agents/agents", { recursive: true });
    await env.writeFile(
      ".agents/agents/fast.md",
      "---\nmodel: anthropic/claude-sonnet-4-5\n---\nbe fast"
    );

    const { agents } = await loadAgents(env, [".agents"]);

    expect(agents[0]?.model).toEqual({
      providerId: "anthropic",
      modelId: "claude-sonnet-4-5",
    });
  });
});
