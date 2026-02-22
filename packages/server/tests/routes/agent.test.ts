import { beforeEach, describe, expect, it, vi } from "vitest";

const listAgentsMock = vi.fn();

vi.mock("@sakti-code/core", () => ({
  listAgents: listAgentsMock,
}));

describe("agent route", () => {
  beforeEach(() => {
    listAgentsMock.mockReset();
  });

  it("returns agents from core registry", async () => {
    listAgentsMock.mockReturnValue([{ name: "build" }, { name: "plan" }]);

    const { default: agentRouter } = await import("../../src/routes/agent");
    const response = await agentRouter.request("http://localhost/api/agents");
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.agents).toEqual([
      { id: "build", name: "Build Agent" },
      { id: "plan", name: "Plan Agent" },
    ]);
  });

  it("falls back to raw name for unmapped agents", async () => {
    listAgentsMock.mockReturnValue([{ name: "custom-agent" }]);

    const { default: agentRouter } = await import("../../src/routes/agent");
    const response = await agentRouter.request("http://localhost/api/agents");
    const data = await response.json();

    expect(data.agents).toEqual([{ id: "custom-agent", name: "custom-agent" }]);
  });
});
