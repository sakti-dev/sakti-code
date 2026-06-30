import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { searchProjectFiles } from "../file-search.ts";

describe("searchProjectFiles", () => {
  it("finds files by fuzzy match (fff path)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fff-search-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "app.ts"), "x");
    writeFileSync(join(dir, "README.md"), "x");

    const results = await searchProjectFiles(dir, "app", 10);

    const paths = results.map((r) => r.path);
    expect(paths).toContain("src/app.ts");
  });

  it("returns file entries with a kind", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fff-kind-"));
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "app.ts"), "x");

    const results = await searchProjectFiles(dir, "app", 10);

    const hit = results.find((r) => r.path === "src/app.ts");
    expect(hit).toBeDefined();
    expect(hit?.kind === "file" || hit?.kind === "directory").toBe(true);
  });
});
