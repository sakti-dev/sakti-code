import { describe, expect, it } from "vite-plus/test";
import { buildRows, type CatalogItem, type FileItem } from "../context-rows";

const commands: CatalogItem[] = [{ name: "commit", description: "commit and push" }];
const skills: CatalogItem[] = [{ name: "graphify", description: "build a graph" }];
const files: FileItem[] = [
  { kind: "file", path: "src/a.ts" },
  { kind: "file", path: "src/b.ts" },
];

describe("buildRows (/ mode)", () => {
  it("lists commands then skills with group labels", () => {
    const rows = buildRows({ mode: "/", query: "", commands, skills, files: [] });
    expect(rows.map((r) => r.token)).toEqual(["/commit", "skill:graphify"]);
    expect(rows[0]!.group).toBe("Commands");
    expect(rows[1]!.group).toBe("Skills");
    expect(rows[0]!).toMatchObject({
      id: "cmd:commit",
      label: "commit",
      description: "commit and push",
    });
  });

  it("filters commands + skills by query over name and description", () => {
    const rows = buildRows({ mode: "/", query: "graph", commands, skills, files: [] });
    expect(rows.map((r) => r.token)).toEqual(["skill:graphify"]);
  });
});

describe("buildRows (@ mode)", () => {
  it("lists files under a Files group", () => {
    const rows = buildRows({ mode: "@", query: "", commands: [], skills: [], files });
    expect(rows.map((r) => r.token)).toEqual(["@src/a.ts", "@src/b.ts"]);
    expect(rows[0]!.group).toBe("Files");
  });

  it("offers a 'use as path' row when no files match a non-empty query", () => {
    const rows = buildRows({
      mode: "@",
      query: "deep/miss.ts",
      commands: [],
      skills: [],
      files: [],
    });
    expect(rows.map((r) => r.token)).toEqual(["@deep/miss.ts"]);
    expect(rows[0]!.id).toBe("use-as-path");
  });

  it("does NOT offer 'use as path' when files exist or query is empty", () => {
    expect(
      buildRows({ mode: "@", query: "src", commands: [], skills: [], files }).some(
        (r) => r.id === "use-as-path",
      ),
    ).toBe(false);
    expect(buildRows({ mode: "@", query: "", commands: [], skills: [], files: [] })).toEqual([]);
  });

  it("lists directory and file results together", () => {
    const rows = buildRows({
      mode: "@",
      query: "components",
      commands: [],
      skills: [],
      files: [
        { kind: "directory", path: "src/components" },
        { kind: "file", path: "src/components/button.tsx" },
      ],
    });

    expect(rows.map((r) => r.group)).toEqual(["Files", "Files"]);
    expect(rows.map((r) => r.token)).toEqual(["@src/components", "@src/components/button.tsx"]);
    expect(rows[0]).toMatchObject({
      id: "dir:src/components",
      label: "src/components",
    });
    expect(rows[0]?.description).toBeUndefined();
  });
});
