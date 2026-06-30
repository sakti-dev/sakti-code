import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";

/**
 * Guards the workspace build pipeline (change: packageable-desktop-build).
 * Every package in the desktop main-process dependency closure MUST ship
 * conditional exports (dev→src, types/default→dist) AND have the compiled
 * dist artifacts present. Catches regressions where a package is reverted to
 * source-only exports or its build is dropped — both re-break packaging
 * (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING).
 */
const root = resolve(process.cwd(), "../../");
const SRC_EXPORT = /^\.\/src\//;
const DIST_EXPORT = /^\.\/dist\//;
const PACKAGES = [
  "packages/logger",
  "packages/llm",
  "packages/tools",
  "packages/agent",
  "packages/db",
  "apps/server",
];

type Cond = Record<string, string | undefined>;
type Exports = Record<string, Cond | string | undefined>;

for (const pkg of PACKAGES) {
  const dir = resolve(root, pkg);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const json = JSON.parse(readFileSync(resolve(dir, "package.json"), "utf8")) as {
    exports?: Exports;
  };

  describe(`${pkg} build artifacts`, () => {
    const exports = json.exports ?? {};
    for (const [subpath, entry] of Object.entries(exports)) {
      if (typeof entry !== "object" || entry === null) {
        it(`${subpath} uses conditional exports (not a bare string)`, () => {
          throw new Error(`${pkg} ${subpath} export must be conditional`);
        });
        continue;
      }
      const cond = entry as Cond;
      it(`${subpath}: has development→src, types→dist, default→dist`, () => {
        expect(cond.development, "development condition").toMatch(SRC_EXPORT);
        expect(cond.types, "types condition").toMatch(DIST_EXPORT);
        expect(cond.default, "default condition").toMatch(DIST_EXPORT);
      });

      it(`${subpath}: compiled default + types targets exist on disk`, () => {
        for (const target of [cond.default, cond.types]) {
          if (!target) continue;
          const file = resolve(dir, target);
          expect(existsSync(file), `${target} missing — run pnpm build`).toBe(true);
        }
      });
    }
  });
}
