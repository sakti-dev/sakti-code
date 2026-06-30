import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import pkg from "../../package.json";

describe("logger package exports contract", () => {
  it.each([
    [".", "src/index.ts", "dist/index.mjs", "dist/index.d.mts"],
    ["./node", "src/node.ts", "dist/node.mjs", "dist/node.d.mts"],
  ] as const)(
    "%s export maps dev→src, default→dist, types→d.mts",
    (subpath, srcFile, defaultFile, typesFile) => {
      const exp = (pkg.exports as Record<string, Record<string, string> | undefined>)[subpath];
      if (!exp) throw new Error(`export ${subpath} missing`);
      expect(exp.development).toBe(`./${srcFile}`);
      expect(exp.default).toBe(`./${defaultFile}`);
      expect(exp.types).toBe(`./${typesFile}`);
    },
  );

  it("compiled dist artifacts exist for every default/types target", () => {
    const root = resolve(import.meta.dirname, "../..");
    const targets = ["dist/index.mjs", "dist/index.d.mts", "dist/node.mjs", "dist/node.d.mts"];
    for (const t of targets) {
      expect(existsSync(resolve(root, t)), `${t} missing — run pnpm build`).toBe(true);
    }
  });
});
