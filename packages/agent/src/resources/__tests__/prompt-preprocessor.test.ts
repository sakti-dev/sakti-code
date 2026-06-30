import { describe, expect, it } from "vite-plus/test";
import {
  expandFileMentions,
  parseLeadingInvocation,
  planFirstTurn,
  type ReadFile,
} from "../../resources/prompt-preprocessor";

const enc = new TextEncoder();

function readerFor(files: Record<string, Uint8Array>): ReadFile {
  return (path) => {
    const hit = Object.entries(files).find(([k]) => path.endsWith(k));
    return Promise.resolve(hit ? hit[1] : null);
  };
}

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
    expect(parseLeadingInvocation("skill:graphify do the thing", resources)).toEqual({
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
    expect(parseLeadingInvocation("run skill:graphify now", resources)).toEqual({ kind: "prompt" });
  });
});

describe("expandFileMentions", () => {
  it("inlines an existing file's content for @path", async () => {
    const out = await expandFileMentions(
      "see @foo.txt please",
      "/proj",
      readerFor({ "foo.txt": enc.encode("hello file") }),
    );
    expect(out).toContain('<file path="foo.txt">');
    expect(out).toContain("hello file");
    expect(out).toContain("please");
  });

  it("resolves nested relative paths", async () => {
    const out = await expandFileMentions(
      "@src/a.ts",
      "/proj",
      readerFor({ "src/a.ts": enc.encode("export const x = 1;") }),
    );
    expect(out).toContain("export const x = 1;");
  });

  it("leaves non-file @tokens untouched (e.g. emails)", async () => {
    const out = await expandFileMentions("email me@host.com ok", "/proj", readerFor({}));
    expect(out).toBe("email me@host.com ok");
  });

  it("leaves a non-existent path untouched (no error note)", async () => {
    const out = await expandFileMentions("@nope/missing.txt", "/proj", readerFor({}));
    expect(out).toBe("@nope/missing.txt");
  });

  it("truncates files larger than the byte cap", async () => {
    const out = await expandFileMentions(
      "@big.txt",
      "/proj",
      readerFor({ "big.txt": enc.encode("x".repeat(70_000)) }),
    );
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
    const plan = await planFirstTurn("/commit feat: x", loaded, "/tmp", readerFor({}));
    expect(plan).toEqual({ kind: "template", name: "commit", args: "feat: x" });
  });

  it("plans a skill turn for a leading skill:name", async () => {
    const plan = await planFirstTurn("skill:graphify go", loaded, "/tmp", readerFor({}));
    expect(plan).toEqual({ kind: "skill", name: "graphify", args: "go" });
  });

  it("plans a prompt turn with @file expanded for ordinary text", async () => {
    const plan = await planFirstTurn(
      "look at @f.txt",
      loaded,
      "/proj",
      readerFor({ "f.txt": enc.encode("DATA") }),
    );
    expect(plan.kind).toBe("prompt");
    if (plan.kind === "prompt") {
      expect(plan.text).toContain("DATA");
    }
  });

  it("plans a prompt turn leaving unknown @tokens untouched", async () => {
    const plan = await planFirstTurn("email me@host.com", loaded, "/tmp", readerFor({}));
    expect(plan.kind).toBe("prompt");
    if (plan.kind === "prompt") {
      expect(plan.text).toBe("email me@host.com");
    }
  });
});
