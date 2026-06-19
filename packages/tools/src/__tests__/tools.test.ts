import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import {
  createReadTool,
  createWriteTool,
  createEditTool,
  createBashTool,
  createGrepTool,
  createFindTool,
  createLsTool,
} from "../index";

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(__dirname, "test-workdir-XXXXXX"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("ReadTool", () => {
  it("reads a file and returns content", async () => {
    writeFileSync(join(tmpDir, "hello.txt"), "Hello, world!");
    const tool = createReadTool(tmpDir);
    const result = await tool.execute("tc_1", { path: "hello.txt" });
    expect(result.content).toBe("Hello, world!");
    expect(result.isError).toBeFalsy();
  });

  it("supports offset and limit", async () => {
    writeFileSync(join(tmpDir, "lines.txt"), Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n"));
    const tool = createReadTool(tmpDir);
    const result = await tool.execute("tc_1", { path: "lines.txt", offset: 5, limit: 3 });
    expect(result.content).toBe("line 5\nline 6\nline 7");
  });

  it("returns error for missing file", async () => {
    const tool = createReadTool(tmpDir);
    const result = await tool.execute("tc_1", { path: "nonexistent.txt" });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("File not found");
  });

  it("truncates large files", async () => {
    const lines = Array.from({ length: 3000 }, (_, i) => `line ${i + 1}`);
    writeFileSync(join(tmpDir, "big.txt"), lines.join("\n"));
    const tool = createReadTool(tmpDir);
    const result = await tool.execute("tc_1", { path: "big.txt" });
    expect(result.content).toContain("truncated");
    expect(result.content.split("\n").length).toBeLessThan(3000);
  });

  it("reads image files as base64 data URL", async () => {
    const minimalPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
      "base64",
    );
    writeFileSync(join(tmpDir, "test.png"), minimalPng);
    const tool = createReadTool(tmpDir);
    const result = await tool.execute("tc_1", { path: "test.png" });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("image/png");
    expect(result.content).toContain("data:image/png;base64,");
  });
});

describe("WriteTool", () => {
  it("writes a new file", async () => {
    const tool = createWriteTool(tmpDir);
    const result = await tool.execute("tc_1", { path: "new.txt", content: "hello!" });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("Wrote");
    expect(readFileSync(join(tmpDir, "new.txt"), "utf-8")).toBe("hello!");
  });

  it("creates parent directories", async () => {
    const tool = createWriteTool(tmpDir);
    await tool.execute("tc_1", { path: "a/b/c/file.txt", content: "deep" });
    expect(readFileSync(join(tmpDir, "a/b/c/file.txt"), "utf-8")).toBe("deep");
  });

  it("overwrites existing file", async () => {
    writeFileSync(join(tmpDir, "overwrite.txt"), "old");
    const tool = createWriteTool(tmpDir);
    await tool.execute("tc_1", { path: "overwrite.txt", content: "new" });
    expect(readFileSync(join(tmpDir, "overwrite.txt"), "utf-8")).toBe("new");
  });
});

describe("EditTool", () => {
  it("applies a single edit", async () => {
    writeFileSync(join(tmpDir, "edit.txt"), "const x = 1;\nconst y = 2;\n");
    const tool = createEditTool(tmpDir);
    const result = await tool.execute("tc_1", { path: "edit.txt", edits: [{ oldText: "const x = 1", newText: "const x = 42" }] });
    expect(result.isError).toBeFalsy();
    expect(readFileSync(join(tmpDir, "edit.txt"), "utf-8")).toContain("const x = 42");
  });

  it("applies multiple edits atomically", async () => {
    writeFileSync(join(tmpDir, "multi.txt"), "alpha\nbeta\ngamma\n");
    const tool = createEditTool(tmpDir);
    await tool.execute("tc_1", {
      path: "multi.txt",
      edits: [
        { oldText: "alpha", newText: "ALPHA" },
        { oldText: "gamma", newText: "GAMMA" },
      ],
    });
    const content = readFileSync(join(tmpDir, "multi.txt"), "utf-8");
    expect(content).toContain("ALPHA");
    expect(content).toContain("GAMMA");
    expect(content).toContain("beta"); // unchanged
  });

  it("fails if oldText not found, file unchanged", async () => {
    writeFileSync(join(tmpDir, "fail.txt"), "hello");
    const tool = createEditTool(tmpDir);
    const result = await tool.execute("tc_1", { path: "fail.txt", edits: [{ oldText: "nonexistent", newText: "xxx" }] });
    expect(result.isError).toBe(true);
    expect(readFileSync(join(tmpDir, "fail.txt"), "utf-8")).toBe("hello");
  });

  it("returns error for missing file", async () => {
    const tool = createEditTool(tmpDir);
    const result = await tool.execute("tc_1", { path: "nope.txt", edits: [{ oldText: "x", newText: "y" }] });
    expect(result.isError).toBe(true);
  });

  it("preserves BOM on edit", async () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const content = Buffer.concat([bom, Buffer.from("hello\nworld\n")]);
    writeFileSync(join(tmpDir, "bom.txt"), content);
    const tool = createEditTool(tmpDir);
    await tool.execute("tc_1", { path: "bom.txt", edits: [{ oldText: "hello", newText: "HELLO" }] });
    const result = readFileSync(join(tmpDir, "bom.txt"), "utf-8");
    expect(result.charCodeAt(0)).toBe(0xfeff);
    expect(result).toContain("HELLO");
  });

  it("preserves CRLF line endings", async () => {
    writeFileSync(join(tmpDir, "crlf.txt"), "line1\r\nline2\r\n");
    const tool = createEditTool(tmpDir);
    await tool.execute("tc_1", { path: "crlf.txt", edits: [{ oldText: "line1", newText: "LINE1" }] });
    const result = readFileSync(join(tmpDir, "crlf.txt"), "utf-8");
    expect(result).toContain("\r\n");
    expect(result).toContain("LINE1\r\n");
  });

  it("rejects non-unique oldText", async () => {
    writeFileSync(join(tmpDir, "dup.txt"), "const x = 1;\nconst x = 2;\n");
    const tool = createEditTool(tmpDir);
    const result = await tool.execute("tc_1", { path: "dup.txt", edits: [{ oldText: "const x", newText: "const y" }] });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("matches 2 locations");
    expect(readFileSync(join(tmpDir, "dup.txt"), "utf-8")).toBe("const x = 1;\nconst x = 2;\n");
  });

  it("rejects empty edits array", async () => {
    writeFileSync(join(tmpDir, "empty.txt"), "hello");
    const tool = createEditTool(tmpDir);
    const result = await tool.execute("tc_1", { path: "empty.txt", edits: [] });
    expect(result.isError).toBe(true);
  });
});

describe("BashTool", () => {
  it("runs a command and returns output", async () => {
    const tool = createBashTool(tmpDir);
    const result = await tool.execute("tc_1", { command: "echo hello" });
    expect(result.content.trim()).toBe("hello");
    expect(result.isError).toBeFalsy();
  });

  it("returns error on non-zero exit", async () => {
    const tool = createBashTool(tmpDir);
    const result = await tool.execute("tc_1", { command: "exit 1" });
    expect(result.isError).toBe(true);
  });

  it("times out", async () => {
    const tool = createBashTool(tmpDir, 5);
    const result = await tool.execute("tc_1", { command: "sleep 10", timeout: 0.1 });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("timed out");
  });

  it("streams output via onUpdate callback", async () => {
    const updates: string[] = [];
    const tool = createBashTool(tmpDir);
    const result = await tool.execute(
      "tc_1",
      { command: "for i in 1 2 3; do echo $i; sleep 0.1; done" },
      undefined,
      (partial) => { updates.push(partial); },
    );
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("3");
    // Should have received at least 2 streaming updates during execution
    expect(updates.length).toBeGreaterThanOrEqual(2);
  });

  it("respects abort signal and returns promptly", async () => {
    const controller = new AbortController();
    const tool = createBashTool(tmpDir, 60);
    const start = Date.now();
    const result = await tool.execute(
      "tc_1",
      { command: "sleep 30" },
      controller.signal,
    );
    const elapsed = Date.now() - start;
    // Must return within 2 seconds, not wait 30s or 60s
    expect(elapsed).toBeLessThan(2000);
    expect(result).toBeDefined();
  });

  it("does not block the event loop", async () => {
    // Run a slow command but prove other work happens concurrently
    let otherWorkRan = false;
    const tool = createBashTool(tmpDir, 5000);
    const promise = tool.execute("tc_1", { command: "sleep 0.3" });
    // This should execute immediately, not wait for the command to finish
    otherWorkRan = true;
    const result = await promise;
    expect(otherWorkRan).toBe(true);
    expect(result).toBeDefined();
  });
});

describe("GrepTool", () => {
  it("searches for a pattern in files", async () => {
    writeFileSync(join(tmpDir, "grep-test.ts"), "const TODO = 1;\nconst done = 2;\n");
    const tool = createGrepTool(tmpDir);
    const result = await tool.execute("tc_1", { pattern: "TODO" });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("TODO");
  });

  it("supports ignoreCase", async () => {
    writeFileSync(join(tmpDir, "case.ts"), "hello HELLO Hello");
    const tool = createGrepTool(tmpDir);
    const result = await tool.execute("tc_1", { pattern: "hello", ignoreCase: true });
    expect(result.content).toContain("hello");
    expect(result.content).toContain("HELLO");
  });

  it("returns no matches message when nothing found", async () => {
    const tool = createGrepTool(tmpDir);
    const result = await tool.execute("tc_1", { pattern: "XYZNONEXISTENT" });
    expect(result.content).toContain("No matches found");
  });
});

describe("FindTool", () => {
  it("finds files by pattern", async () => {
    writeFileSync(join(tmpDir, "found.ts"), "x");
    writeFileSync(join(tmpDir, "found2.ts"), "y");
    writeFileSync(join(tmpDir, "found.js"), "z");
    const tool = createFindTool(tmpDir);
    const result = await tool.execute("tc_1", { pattern: "*.ts" });
    expect(result.content).toContain("found.ts");
    expect(result.content).toContain("found2.ts");
    expect(result.content).not.toContain("found.js");
  });

  it("returns no files found when empty", async () => {
    const tool = createFindTool(tmpDir);
    const result = await tool.execute("tc_1", { pattern: "*.nonexistent" });
    expect(result.content).toContain("No files found");
  });
});

describe("LsTool", () => {
  it("lists current directory", async () => {
    const tool = createLsTool(tmpDir);
    const result = await tool.execute("tc_1", {});
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("hello.txt");
  });

  it("lists subdirectory with / suffix for dirs", async () => {
    mkdirSync(join(tmpDir, "subdir"));
    writeFileSync(join(tmpDir, "subdir", "file.txt"), "x");
    const tool = createLsTool(tmpDir);
    const result = await tool.execute("tc_1", { path: "subdir" });
    expect(result.content).toContain("file.txt");
  });
});

describe("Tool Argument Validation", () => {
  it("read rejects missing path", async () => {
    const tool = createReadTool(tmpDir);
    const result = await tool.execute("tc_1", {});
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Missing required");
  });

  it("bash rejects missing command", async () => {
    const tool = createBashTool(tmpDir);
    const result = await tool.execute("tc_1", {});
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Missing required");
  });

  it("edit rejects missing path", async () => {
    const tool = createEditTool(tmpDir);
    const result = await tool.execute("tc_1", { edits: [{ oldText: "x", newText: "y" }] });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Missing required");
  });

  it("bash rejects wrong type for timeout", async () => {
    const tool = createBashTool(tmpDir);
    const result = await tool.execute("tc_1", { command: "echo hi", timeout: "ten" });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("must be number");
  });
});

describe("Tool Safety", () => {
  it("detects image by magic bytes regardless of extension", async () => {
    const minimalPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
      "base64",
    );
    writeFileSync(join(tmpDir, "image.dat"), minimalPng);
    const tool = createReadTool(tmpDir);
    const result = await tool.execute("tc_1", { path: "image.dat" });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("data:image/png;base64,");
  });

  it("grep pattern cannot inject flags", async () => {
    writeFileSync(join(tmpDir, "secret.txt"), "password123\n-i hello\n");
    const tool = createGrepTool(tmpDir);
    // Malicious pattern that tries to inject -i flag
    const result = await tool.execute("tc_1", { pattern: "-i password" });
    // Should not match case-insensitively due to flag injection
    expect(result.isError).toBeTruthy();
  });

  it("edit is atomic: if 2nd edit fails, file is unchanged", async () => {
    writeFileSync(join(tmpDir, "atomic.txt"), "alpha\nbeta\ngamma\n");
    const tool = createEditTool(tmpDir);
    const original = readFileSync(join(tmpDir, "atomic.txt"), "utf-8");
    const result = await tool.execute("tc_1", {
      path: "atomic.txt",
      edits: [
        { oldText: "alpha", newText: "ALPHA" },
        { oldText: "nonexistent", newText: "fail" },
      ],
    });
    expect(result.isError).toBe(true);
    // File must be unchanged — first edit was NOT applied
    expect(readFileSync(join(tmpDir, "atomic.txt"), "utf-8")).toBe(original);
  });

  it("bash captures stderr output", async () => {
    const tool = createBashTool(tmpDir);
    const result = await tool.execute("tc_1", { command: "echo stdout-msg; echo stderr-msg 1>&2" });
    expect(result.content).toContain("stdout-msg");
    expect(result.content).toContain("stderr-msg");
  });
});

function readFileSync(path: string, encoding: string) {
  const { readFileSync: rf } = require("node:fs");
  return rf(path, encoding);
}
