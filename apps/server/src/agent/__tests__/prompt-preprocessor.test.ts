import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  expandFileMentions,
  parseLeadingInvocation,
  planFirstTurn,
} from "../prompt-preprocessor.ts";

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

describe("expandFileMentions", () => {
  it("inlines an existing file's content for @path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sakti-pp-"));
    writeFileSync(join(dir, "foo.txt"), "hello file");
    const out = await expandFileMentions("see @foo.txt please", dir);
    expect(out).toContain('<file path="foo.txt">');
    expect(out).toContain("hello file");
    expect(out).toContain("please");
  });

  it("resolves nested relative paths", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sakti-pp2-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "a.ts"), "export const x = 1;");
    const out = await expandFileMentions("@src/a.ts", dir);
    expect(out).toContain("export const x = 1;");
  });

  it("leaves non-file @tokens untouched (e.g. emails)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sakti-pp3-"));
    const out = await expandFileMentions("email me@host.com ok", dir);
    expect(out).toBe("email me@host.com ok");
  });

  it("leaves a non-existent path untouched (no error note)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sakti-pp4-"));
    const out = await expandFileMentions("@nope/missing.txt", dir);
    expect(out).toBe("@nope/missing.txt");
  });

  it("truncates files larger than the byte cap", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sakti-pp5-"));
    writeFileSync(join(dir, "big.txt"), "x".repeat(70_000));
    const out = await expandFileMentions("@big.txt", dir);
    expect(out).toContain("[truncated:");
    expect(out.length).toBeLessThan(70_000);
  });
});

describe("planFirstTurn", () => {
  const loaded = {
    skills: [{ name: "graphify", description: "g", content: "c" }],
    templates: [{ name: "commit", description: "c", content: "c" }],
  };

  it("plans a template turn for a leading /name", async () => {
    const plan = await planFirstTurn("/commit feat: x", loaded, "/tmp");
    expect(plan).toEqual({ kind: "template", name: "commit", args: "feat: x" });
  });

  it("plans a skill turn for a leading skill:name", async () => {
    const plan = await planFirstTurn("skill:graphify go", loaded, "/tmp");
    expect(plan).toEqual({ kind: "skill", name: "graphify", args: "go" });
  });

  it("plans a prompt turn with @file expanded for ordinary text", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sakti-plan-"));
    writeFileSync(join(dir, "f.txt"), "DATA");
    const plan = await planFirstTurn("look at @f.txt", loaded, dir);
    expect(plan.kind).toBe("prompt");
    if (plan.kind === "prompt") {
      expect(plan.text).toContain("DATA");
    }
  });

  it("plans a prompt turn leaving unknown @tokens untouched", async () => {
    const plan = await planFirstTurn("email me@host.com", loaded, "/tmp");
    expect(plan.kind).toBe("prompt");
    if (plan.kind === "prompt") {
      expect(plan.text).toBe("email me@host.com");
    }
  });
});
