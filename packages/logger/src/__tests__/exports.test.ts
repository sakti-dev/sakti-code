import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import pkg from "../../package.json";

describe("logger package exports contract", () => {
  it.each([
    [".", "src/index.ts", "dist/index.js", "dist/index.d.ts"],
    ["./node", "src/node.ts", "dist/node.js", "dist/node.d.ts"],
  ] as const)("%s export maps dev→src, default→dist, types→d.ts", (subpath, srcFile, defaultFile, typesFile) => {
    const exp = (
      pkg.exports as Record<string, Record<string, string> | undefined>
    )[subpath];
    if (!exp) throw new Error(`export ${subpath} missing`);
    expect(exp.development).toBe(`./${srcFile}`);
    expect(exp.default).toBe(`./${defaultFile}`);
    expect(exp.types).toBe(`./${typesFile}`);
  });

  it("compiled dist artifacts exist for every default/types target", () => {
    const root = resolve(import.meta.dirname, "../..");
    const targets = [
      "dist/index.js",
      "dist/index.d.ts",
      "dist/node.js",
      "dist/node.d.ts",
    ];
    for (const t of targets) {
      expect(
        existsSync(resolve(root, t)),
        `${t} missing — run pnpm build`
      ).toBe(true);
    }
  });
});
