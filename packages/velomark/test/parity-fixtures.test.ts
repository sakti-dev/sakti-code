import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PARITY_FIXTURES = [
  {
    fileName: "math-inline.md",
    includes: "$E = mc^2$",
    minLength: 20,
  },
  {
    fileName: "math-block.md",
    includes: "$$",
    minLength: 20,
  },
  {
    fileName: "html-inline-nested.md",
    includes: "<span class='chip'",
    minLength: 20,
  },
  {
    fileName: "html-block-nested.md",
    includes: "<section",
    minLength: 30,
  },
  {
    fileName: "directive-container.md",
    includes: ":::",
    minLength: 20,
  },
  {
    fileName: "directive-inline.md",
    includes: ":badge[",
    minLength: 20,
  },
  {
    fileName: "streaming-code-growth.md",
    includes: "```ts",
    minLength: 20,
  },
] as const;

const loadParityFixture = (fileName: string): string =>
  readFileSync(
    resolve(process.cwd(), "test/fixtures/parity", fileName),
    "utf8"
  );

describe("velomark parity fixtures", () => {
  it("includes the expected parity fixture set", () => {
    for (const fixture of PARITY_FIXTURES) {
      const filePath = resolve(
        process.cwd(),
        "test/fixtures/parity",
        fixture.fileName
      );
      expect(existsSync(filePath)).toBe(true);
    }
  });

  for (const fixture of PARITY_FIXTURES) {
    it(`keeps ${fixture.fileName} non-trivial and category-specific`, () => {
      const source = loadParityFixture(fixture.fileName);

      expect(source.length).toBeGreaterThan(fixture.minLength);
      expect(source).toContain(fixture.includes);
    });
  }
});
