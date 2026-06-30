import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { inspect, list, readText } from "../read-filesystem.ts";

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(import.meta.dirname, "test-workdir-XXXXXX"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("inspect", () => {
  it("returns 'file' for a file", async () => {
    writeFileSync(join(tmpDir, "file.txt"), "hello");
    const result = await inspect(join(tmpDir, "file.txt"));
    expect(result).toBe("file");
  });

  it("returns 'directory' for a directory", async () => {
    mkdirSync(join(tmpDir, "dir"));
    const result = await inspect(join(tmpDir, "dir"));
    expect(result).toBe("directory");
  });

  it("throws for a broken symlink", async () => {
    const linkPath = join(tmpDir, "broken-link.txt");
    const { symlink } = await import("node:fs/promises");
    await symlink(join(tmpDir, "missing.txt"), linkPath);
    await expect(inspect(linkPath)).rejects.toThrow();
  });
});

describe("list", () => {
  it("lists entries with directory suffix", async () => {
    mkdirSync(join(tmpDir, "list-dir"));
    writeFileSync(join(tmpDir, "list-dir", "a.txt"), "x");
    mkdirSync(join(tmpDir, "list-dir", "sub"));

    const page = await list(join(tmpDir, "list-dir"));
    const paths = page.entries.map((e) => e.path);
    expect(paths).toContain("a.txt");
    expect(paths).toContain("sub/");
  });

  it("sorts directories first, then case-insensitive", async () => {
    mkdirSync(join(tmpDir, "sort-dir"));
    writeFileSync(join(tmpDir, "sort-dir", "B.txt"), "x");
    writeFileSync(join(tmpDir, "sort-dir", "a.txt"), "x");
    mkdirSync(join(tmpDir, "sort-dir", "Dir"));

    const page = await list(join(tmpDir, "sort-dir"));
    const paths = page.entries.map((e) => e.path);
    expect(paths).toEqual(["Dir/", "a.txt", "B.txt"]);
  });

  it("includes dotfiles", async () => {
    mkdirSync(join(tmpDir, "dot-dir"));
    writeFileSync(join(tmpDir, "dot-dir", ".hidden"), "x");

    const page = await list(join(tmpDir, "dot-dir"));
    expect(page.entries.map((e) => e.path)).toContain(".hidden");
  });

  it("pages with offset and limit", async () => {
    mkdirSync(join(tmpDir, "page-dir"));
    for (let i = 1; i <= 5; i++) {
      writeFileSync(join(tmpDir, "page-dir", `file${i}.txt`), "x");
    }

    const page = await list(join(tmpDir, "page-dir"), { offset: 2, limit: 2 });
    expect(page.entries).toHaveLength(2);
    expect(page.truncated).toBe(true);
    expect(page.next).toBe(4);
  });

  it("returns empty page for empty directory", async () => {
    mkdirSync(join(tmpDir, "empty-dir"));
    const page = await list(join(tmpDir, "empty-dir"));
    expect(page.entries).toHaveLength(0);
    expect(page.truncated).toBe(false);
  });

  it("filters entries that escape the parent via symlink", async () => {
    mkdirSync(join(tmpDir, "escape-dir"));
    mkdirSync(join(tmpDir, "escape-target"));
    const { symlink } = await import("node:fs/promises");
    await symlink(join(tmpDir, "escape-target"), join(tmpDir, "escape-dir", "outside"));

    const page = await list(join(tmpDir, "escape-dir"));
    expect(page.entries.map((e) => e.path)).not.toContain("outside/");
  });
});

describe("readText", () => {
  it("reads full file content", async () => {
    writeFileSync(join(tmpDir, "read.txt"), "line1\nline2\nline3");
    const page = await readText(join(tmpDir, "read.txt"));
    expect(page.content).toContain("line1");
    expect(page.content).toContain("line3");
    expect(page.offset).toBe(1);
    expect(page.truncated).toBe(false);
  });

  it("pages with offset and limit", async () => {
    writeFileSync(
      join(tmpDir, "paged.txt"),
      Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n"),
    );
    const page = await readText(join(tmpDir, "paged.txt"), { offset: 3, limit: 2 });
    expect(page.content).toContain("line 3");
    expect(page.content).toContain("line 4");
    expect(page.offset).toBe(3);
    expect(page.truncated).toBe(true);
    expect(page.next).toBe(5);
  });

  it("throws when offset is beyond end of file", async () => {
    writeFileSync(join(tmpDir, "short.txt"), "a\nb");
    await expect(readText(join(tmpDir, "short.txt"), { offset: 10 })).rejects.toThrow(
      "beyond end of file",
    );
  });
});
