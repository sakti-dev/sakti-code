import { describe, expect, it } from "vitest";
import { parseLeadingInvocation } from "../prompt-preprocessor.ts";

const skills = [{ name: "graphify", description: "g", content: "c" }];
const templates = [{ name: "commit", description: "c", content: "c" }];
const resources = { skills, templates };

describe("parseLeadingInvocation", () => {
  it("detects a leading /command with args", () => {
    expect(parseLeadingInvocation("/commit feat: foo", resources)).toEqual({
      kind: "template",
      name: "commit",
      args: "feat: foo",
    });
  });

  it("detects a leading skill: invocation with instructions", () => {
    expect(
      parseLeadingInvocation("skill:graphify do the thing", resources)
    ).toEqual({
      kind: "skill",
      name: "graphify",
      args: "do the thing",
    });
  });

  it("matches a template with no args (empty string)", () => {
    expect(parseLeadingInvocation("/commit", resources)).toEqual({
      kind: "template",
      name: "commit",
      args: "",
    });
  });

  it("matches a skill with no args (empty string)", () => {
    expect(parseLeadingInvocation("skill:graphify", resources)).toEqual({
      kind: "skill",
      name: "graphify",
      args: "",
    });
  });

  it("falls back to prompt when /name is not a known template", () => {
    expect(parseLeadingInvocation("/unknown x", resources)).toEqual({
      kind: "prompt",
    });
  });

  it("falls back to prompt when skill:name is not a known skill", () => {
    expect(parseLeadingInvocation("skill:nope", resources)).toEqual({
      kind: "prompt",
    });
  });

  it("returns prompt for ordinary text", () => {
    expect(parseLeadingInvocation("hello world", resources)).toEqual({
      kind: "prompt",
    });
  });

  it("ignores / and skill: that are not at the start", () => {
    expect(parseLeadingInvocation("see /commit later", resources)).toEqual({
      kind: "prompt",
    });
    expect(parseLeadingInvocation("run skill:graphify now", resources)).toEqual(
      { kind: "prompt" }
    );
  });
});
