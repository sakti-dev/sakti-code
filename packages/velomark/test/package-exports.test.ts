import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("package exports", () => {
  it("points published solid import conditions at JavaScript artifacts", () => {
    const packageJsonPath = path.resolve(process.cwd(), "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      exports: {
        ".": {
          solid: {
            development: string;
            import: string;
          };
        };
      };
    };

    expect(packageJson.exports["."].solid.development).toBe("./dist/dev.js");
    expect(packageJson.exports["."].solid.import).toBe("./dist/index.js");
  });
});
