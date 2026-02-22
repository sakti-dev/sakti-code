import { parseSkillInfo } from "@/skill/types";
import { describe, expect, it } from "vitest";

describe("frontmatter parsing", () => {
  it("should parse standard YAML frontmatter", () => {
    const md = `---
name: standard-skill
description: A standard skill
---
# Content`;

    const result = parseSkillInfo(md, "/path");
    expect(result.name).toBe("standard-skill");
    expect(result.description).toBe("A standard skill");
  });

  it("should handle Claude Code style invalid YAML", () => {
    const md = `---
name: test
description: Uses: multiple: colons
---
# Content`;

    const result = parseSkillInfo(md, "/path");
    expect(result.name).toBe("test");
  });

  it("should handle empty lines in frontmatter", () => {
    const md = `---
name: test

description: With blank line
---
# Content`;

    const result = parseSkillInfo(md, "/path");
    expect(result.name).toBe("test");
  });
});
