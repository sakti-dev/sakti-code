import { describe, it, expect } from "vitest";
import { buildSddProgram } from "../../program.js";

describe("sakti state command registration", () => {
  it("registers the state command group", () => {
    const program = buildSddProgram("0.0.0-test");
    const commands = program.commands.map((c) => c.name());
    expect(commands).toContain("state");
  });

  it("state has get, set, transition subcommands", () => {
    const program = buildSddProgram("0.0.0-test");
    const stateCmd = program.commands.find((c) => c.name() === "state");
    expect(stateCmd).toBeDefined();
    const subcommands = stateCmd!.commands.map((c) => c.name());
    expect(subcommands).toEqual(expect.arrayContaining(["get", "set", "transition"]));
  });
});
