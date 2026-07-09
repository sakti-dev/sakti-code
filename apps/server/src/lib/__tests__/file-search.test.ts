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

  it("ranks a matching directory before files inside it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fff-context-dir-"));
    mkdirSync(join(dir, "apps", "server", "src", "routes", "projects"), { recursive: true });
    writeFileSync(join(dir, "apps", "server", "src", "routes", "projects", "search-files.ts"), "x");
    writeFileSync(join(dir, "apps", "server", "src", "routes", "projects", "context.ts"), "x");

    const results = await searchProjectFiles(dir, "routes/projects", 10);

    expect(results[0]).toEqual({
      kind: "directory",
      path: "apps/server/src/routes/projects",
    });
    expect(results.map((r) => r.path)).toContain("apps/server/src/routes/projects/search-files.ts");
  });

  it("treats a trailing slash query as directory intent", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fff-context-slash-"));
    mkdirSync(join(dir, "src", "components"), { recursive: true });
    writeFileSync(join(dir, "src", "components", "button.tsx"), "x");

    const results = await searchProjectFiles(dir, "components/", 10);

    expect(results).toEqual([{ kind: "directory", path: "src/components" }]);
  });

  it("keeps exact file basename matches above weaker directory matches", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fff-context-file-"));
    mkdirSync(join(dir, "src", "components"), { recursive: true });
    mkdirSync(join(dir, "src", "button-utils"), { recursive: true });
    writeFileSync(join(dir, "src", "components", "button.tsx"), "x");
    writeFileSync(join(dir, "src", "button-utils", "index.ts"), "x");

    const results = await searchProjectFiles(dir, "button.tsx", 10);

    expect(results[0]).toEqual({ kind: "file", path: "src/components/button.tsx" });
  });

  it("keeps filename-like partial queries from being swallowed by directory boosts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fff-context-partial-file-"));
    mkdirSync(join(dir, "apps", "desktop", "src", "components", "chat-input"), {
      recursive: true,
    });
    writeFileSync(
      join(dir, "apps", "desktop", "src", "components", "chat-input", "chat-input.tsx"),
      "x",
    );
    writeFileSync(
      join(dir, "apps", "desktop", "src", "components", "chat-input", "context-rows.ts"),
      "x",
    );

    const results = await searchProjectFiles(dir, "chat-input.t", 10);

    expect(results[0]).toEqual({
      kind: "file",
      path: "apps/desktop/src/components/chat-input/chat-input.tsx",
    });
  });

  it("includes files immediately after the matching directory for directory-like names", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fff-context-dir-with-files-"));
    mkdirSync(join(dir, "apps", "desktop", "src", "components", "chat-input", "__tests__"), {
      recursive: true,
    });
    mkdirSync(join(dir, "docs", "superpowers", "plans"), { recursive: true });
    writeFileSync(
      join(dir, "apps", "desktop", "src", "components", "chat-input", "chat-input.tsx"),
      "x",
    );
    writeFileSync(
      join(
        dir,
        "apps",
        "desktop",
        "src",
        "components",
        "chat-input",
        "__tests__",
        "chat-input.test.tsx",
      ),
      "x",
    );
    writeFileSync(join(dir, "docs", "superpowers", "plans", "chat-input-note.md"), "x");

    const results = await searchProjectFiles(dir, "chat-input", 10);

    expect(results[0]).toEqual({
      kind: "directory",
      path: "apps/desktop/src/components/chat-input",
    });
    expect(results.slice(1, 4)).toEqual([
      {
        kind: "file",
        path: "apps/desktop/src/components/chat-input/chat-input.tsx",
      },
      {
        kind: "file",
        path: "apps/desktop/src/components/chat-input/__tests__/chat-input.test.tsx",
      },
      { kind: "file", path: "docs/superpowers/plans/chat-input-note.md" },
    ]);
    expect(results.map((result) => result.path)).not.toContain("apps");
    expect(results.map((result) => result.path)).not.toContain("docs");
  });

  it("returns directories for broad listings", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fff-context-listing-"));
    mkdirSync(join(dir, "src", "features"), { recursive: true });
    writeFileSync(join(dir, "src", "features", "index.ts"), "x");

    const results = await searchProjectFiles(dir, "", 20);

    expect(results).toContainEqual({ kind: "directory", path: "src" });
    expect(results).toContainEqual({ kind: "directory", path: "src/features" });
  });

  it("respects limit after context ranking", async () => {
    const dir = mkdtempSync(join(tmpdir(), "fff-context-limit-"));
    mkdirSync(join(dir, "src", "components"), { recursive: true });
    writeFileSync(join(dir, "src", "components", "button.tsx"), "x");
    writeFileSync(join(dir, "src", "components", "card.tsx"), "x");

    const results = await searchProjectFiles(dir, "components", 1);

    expect(results).toEqual([{ kind: "directory", path: "src/components" }]);
  });
});
