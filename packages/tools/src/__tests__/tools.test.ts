import {
  globSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type { AgentToolResult } from "@sakti-code/agent";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
} from "../index";

function getTextContent(result: AgentToolResult<unknown>): string {
  const first = result.content[0];
  if (first && "text" in first) {
    return first.text;
  }
  return "";
}

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(import.meta.dirname, "test-workdir-XXXXXX"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("ReadTool", () => {
  it("reads a file and returns content", async () => {
    writeFileSync(join(tmpDir, "hello.txt"), "Hello, world!");
    const tool = createReadTool(tmpDir);
    const result = await tool.execute("tc_1", { path: "hello.txt" });
    expect(getTextContent(result)).toBe("Hello, world!");
  });

  it("supports offset and limit", async () => {
    writeFileSync(
      join(tmpDir, "lines.txt"),
      Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n")
    );
    const tool = createReadTool(tmpDir);
    const result = await tool.execute("tc_1", {
      path: "lines.txt",
      offset: 5,
      limit: 3,
    });
    expect(getTextContent(result)).toContain("line 5\nline 6\nline 7");
  });

  it("returns error for missing file", async () => {
    const tool = createReadTool(tmpDir);
    await expect(
      tool.execute("tc_1", { path: "nonexistent.txt" })
    ).rejects.toThrow();
  });

  it("truncates large files", async () => {
    const lines = Array.from({ length: 3000 }, (_, i) => `line ${i + 1}`);
    writeFileSync(join(tmpDir, "big.txt"), lines.join("\n"));
    const tool = createReadTool(tmpDir);
    const result = await tool.execute("tc_1", { path: "big.txt" });
    const text = getTextContent(result);
    expect(text).toContain("lines");
    expect(text.split("\n").length).toBeLessThan(3000);
  });

  it("reads image files as base64 data URL", async () => {
    const minimalPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
      "base64"
    );
    writeFileSync(join(tmpDir, "test.png"), minimalPng);
    const tool = createReadTool(tmpDir);
    const result = await tool.execute("tc_1", { path: "test.png" });
    const text = getTextContent(result);
    expect(text).toContain("image/png");
    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "image", mimeType: "image/png" }),
      ])
    );
  });

  it("emits [path#HASH] header and numbered lines when snapshotStore is provided", async () => {
    const content = "line1\nline2\nline3\n";
    writeFileSync(join(tmpDir, "hashed.txt"), content);
    const { InMemorySnapshotStore } = await import(
      "../lib/hashline-utils/snapshots"
    );
    const snapshotStore = new InMemorySnapshotStore();
    const tool = createReadTool(tmpDir, { snapshotStore });
    const result = await tool.execute("tc_1", { path: "hashed.txt" });
    const text = getTextContent(result);
    expect(text).toMatch(/^\[hashed\.txt#[0-9A-F]{4}\]/m);
    expect(text).toContain("1:line1");
    expect(text).toContain("2:line2");
    expect(text).toContain("3:line3");
  });

  it("records snapshot under absolute path when snapshotStore is provided", async () => {
    const content = "a\nb\n";
    writeFileSync(join(tmpDir, "snap.ts"), content);
    const { InMemorySnapshotStore } = await import(
      "../lib/hashline-utils/snapshots"
    );
    const snapshotStore = new InMemorySnapshotStore();
    const tool = createReadTool(tmpDir, { snapshotStore });
    const result = await tool.execute("tc_1", { path: "snap.ts" });
    const text = getTextContent(result);
    const match = text.match(/#([0-9A-F]{4})/);
    expect(match).not.toBeNull();
    const hash = match?.[1];
    expect(hash).toBeDefined();
    expect(snapshotStore.byHash(join(tmpDir, "snap.ts"), hash!)).not.toBeNull();
  });

  it("hashes full file content even for partial reads", async () => {
    const content = `${Array.from(
      { length: 10 },
      (_, i) => `line${i + 1}`
    ).join("\n")}\n`;
    writeFileSync(join(tmpDir, "partial.txt"), content);
    const { InMemorySnapshotStore } = await import(
      "../lib/hashline-utils/snapshots"
    );
    const { computeFileHash } = await import("../lib/hashline-utils/format");
    const snapshotStore = new InMemorySnapshotStore();
    const tool = createReadTool(tmpDir, { snapshotStore });
    const result = await tool.execute("tc_1", {
      path: "partial.txt",
      offset: 3,
      limit: 2,
    });
    const text = getTextContent(result);
    const fullHash = computeFileHash(content);
    expect(text).toContain(`#${fullHash}`);
    expect(text).toContain("3:line3");
    expect(text).toContain("4:line4");
  });

  it("does not emit hash header when no snapshotStore", async () => {
    writeFileSync(join(tmpDir, "plain.txt"), "hello\n");
    const tool = createReadTool(tmpDir);
    const result = await tool.execute("tc_1", { path: "plain.txt" });
    const text = getTextContent(result);
    expect(text).not.toMatch(/^\[plain\.txt#/m);
    expect(text).toContain("hello");
  });
});

describe("WriteTool", () => {
  it("writes a new file", async () => {
    const tool = createWriteTool(tmpDir);
    const result = await tool.execute("tc_1", {
      path: "new.txt",
      content: "hello!",
    });
    expect(getTextContent(result)).toContain("Successfully wrote");
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

  it("records snapshot and emits [path#HASH] when snapshotStore provided", async () => {
    const { InMemorySnapshotStore } = await import(
      "../lib/hashline-utils/snapshots"
    );
    const snapshotStore = new InMemorySnapshotStore();
    const tool = createWriteTool(tmpDir, { snapshotStore });
    const result = await tool.execute("tc_1", {
      path: "snap-write.ts",
      content: "line1\nline2\n",
    });
    const text = getTextContent(result);
    expect(text).toContain("[snap-write.ts#");
    const match = text.match(/#([0-9A-F]{4})/);
    expect(match).not.toBeNull();
    const hash = match?.[1];
    expect(hash).toBeDefined();
    expect(
      snapshotStore.byHash(join(tmpDir, "snap-write.ts"), hash!)
    ).not.toBeNull();
  });

  it("does not emit hash header when no snapshotStore", async () => {
    const tool = createWriteTool(tmpDir);
    const result = await tool.execute("tc_1", {
      path: "plain-write.txt",
      content: "hello",
    });
    const text = getTextContent(result);
    expect(text).not.toMatch(/\[#/);
  });
});

describe("EditTool", () => {
  it("applies a single edit", async () => {
    writeFileSync(join(tmpDir, "edit.txt"), "const x = 1;\nconst y = 2;\n");
    const tool = createEditTool(tmpDir);
    const result = await tool.execute("tc_1", {
      path: "edit.txt",
      edits: [{ oldText: "const x = 1", newText: "const x = 42" }],
    });
    expect(getTextContent(result)).toContain("Successfully");
    expect(readFileSync(join(tmpDir, "edit.txt"), "utf-8")).toContain(
      "const x = 42"
    );
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
    expect(content).toContain("beta");
  });

  it("fails if oldText not found, file unchanged", async () => {
    writeFileSync(join(tmpDir, "fail.txt"), "hello");
    const tool = createEditTool(tmpDir);
    await expect(
      tool.execute("tc_1", {
        path: "fail.txt",
        edits: [{ oldText: "nonexistent", newText: "xxx" }],
      })
    ).rejects.toThrow();
    expect(readFileSync(join(tmpDir, "fail.txt"), "utf-8")).toBe("hello");
  });

  it("returns error for missing file", async () => {
    const tool = createEditTool(tmpDir);
    await expect(
      tool.execute("tc_1", {
        path: "nope.txt",
        edits: [{ oldText: "x", newText: "y" }],
      })
    ).rejects.toThrow();
  });

  it("preserves BOM on edit", async () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const content = Buffer.concat([bom, Buffer.from("hello\nworld\n")]);
    writeFileSync(join(tmpDir, "bom.txt"), content);
    const tool = createEditTool(tmpDir);
    await tool.execute("tc_1", {
      path: "bom.txt",
      edits: [{ oldText: "hello", newText: "HELLO" }],
    });
    const result = readFileSync(join(tmpDir, "bom.txt"), "utf-8");
    expect(result.charCodeAt(0)).toBe(0xfe_ff);
    expect(result).toContain("HELLO");
  });

  it("preserves CRLF line endings", async () => {
    writeFileSync(join(tmpDir, "crlf.txt"), "line1\r\nline2\r\n");
    const tool = createEditTool(tmpDir);
    await tool.execute("tc_1", {
      path: "crlf.txt",
      edits: [{ oldText: "line1", newText: "LINE1" }],
    });
    const result = readFileSync(join(tmpDir, "crlf.txt"), "utf-8");
    expect(result).toContain("\r\n");
    expect(result).toContain("LINE1\r\n");
  });

  it("rejects non-unique oldText", async () => {
    writeFileSync(join(tmpDir, "dup.txt"), "const x = 1;\nconst x = 2;\n");
    const tool = createEditTool(tmpDir);
    await expect(
      tool.execute("tc_1", {
        path: "dup.txt",
        edits: [{ oldText: "const x", newText: "const y" }],
      })
    ).rejects.toThrow("unique");
    expect(readFileSync(join(tmpDir, "dup.txt"), "utf-8")).toBe(
      "const x = 1;\nconst x = 2;\n"
    );
  });

  it("rejects empty edits array", async () => {
    writeFileSync(join(tmpDir, "empty.txt"), "hello");
    const tool = createEditTool(tmpDir);
    await expect(
      tool.execute("tc_1", { path: "empty.txt", edits: [] })
    ).rejects.toThrow();
  });
});

describe("EditTool (hashline mode)", () => {
  it("applies a SWAP patch via hashline mode", async () => {
    const content = "line1\nline2\nline3\n";
    writeFileSync(join(tmpDir, "hl-swap.txt"), content);
    const { InMemorySnapshotStore } = await import(
      "../lib/hashline-utils/snapshots"
    );
    const snapshotStore = new InMemorySnapshotStore();
    const tag = snapshotStore.record(join(tmpDir, "hl-swap.txt"), content);
    const tool = createEditTool(tmpDir, {
      mode: "hashline",
      snapshotStore,
    });
    const result = await tool.execute("tc_1", {
      input: `[hl-swap.txt#${tag}]\nSWAP 2.=2:\n+REPLACED`,
    });
    expect(getTextContent(result)).toContain("[hl-swap.txt#");
    expect(readFileSync(join(tmpDir, "hl-swap.txt"), "utf-8")).toBe(
      "line1\nREPLACED\nline3\n"
    );
  });

  it("applies a DEL patch via hashline mode", async () => {
    const content = "a\nb\nc\n";
    writeFileSync(join(tmpDir, "hl-del.txt"), content);
    const { InMemorySnapshotStore } = await import(
      "../lib/hashline-utils/snapshots"
    );
    const snapshotStore = new InMemorySnapshotStore();
    const tag = snapshotStore.record(join(tmpDir, "hl-del.txt"), content);
    const tool = createEditTool(tmpDir, {
      mode: "hashline",
      snapshotStore,
    });
    await tool.execute("tc_1", {
      input: `[hl-del.txt#${tag}]\nDEL 2.=2`,
    });
    expect(readFileSync(join(tmpDir, "hl-del.txt"), "utf-8")).toBe("a\nc\n");
  });

  it("rejects with mismatch when hash is stale", async () => {
    writeFileSync(join(tmpDir, "hl-stale.txt"), "a\nb\n");
    const { InMemorySnapshotStore } = await import(
      "../lib/hashline-utils/snapshots"
    );
    const snapshotStore = new InMemorySnapshotStore();
    const tool = createEditTool(tmpDir, {
      mode: "hashline",
      snapshotStore,
    });
    await expect(
      tool.execute("tc_1", {
        input: "[hl-stale.txt#0000]\nSWAP 1.=1:\n+X",
      })
    ).rejects.toThrow();
  });

  it("read + edit roundtrip via snapshot store", async () => {
    writeFileSync(join(tmpDir, "roundtrip.ts"), "old line\n");
    const { InMemorySnapshotStore } = await import(
      "../lib/hashline-utils/snapshots"
    );
    const snapshotStore = new InMemorySnapshotStore();
    const readTool = createReadTool(tmpDir, { snapshotStore });
    const editTool = createEditTool(tmpDir, {
      mode: "hashline",
      snapshotStore,
    });
    const readResult = await readTool.execute("tc_1", { path: "roundtrip.ts" });
    const readText = getTextContent(readResult);
    const tag = readText.match(/#([0-9A-F]{4})/)?.[1];
    expect(tag).toBeDefined();
    await editTool.execute("tc_1", {
      input: `[roundtrip.ts#${tag}]\nSWAP 1.=1:\n+new line`,
    });
    expect(readFileSync(join(tmpDir, "roundtrip.ts"), "utf-8")).toBe(
      "new line\n"
    );
  });
});

describe("EditTool (hashline noop-loop-guard)", () => {
  it("escalates to a thrown error after 3 consecutive identical no-op edits", async () => {
    const content = "line1\nline2\nline3\n";
    writeFileSync(join(tmpDir, "hl-noop.txt"), content);
    const { InMemorySnapshotStore } = await import(
      "../lib/hashline-utils/snapshots"
    );
    const snapshotStore = new InMemorySnapshotStore();
    const tag = snapshotStore.record(join(tmpDir, "hl-noop.txt"), content);
    const tool = createEditTool(tmpDir, {
      mode: "hashline",
      snapshotStore,
      noopOwner: {},
    });
    const noopInput = `[hl-noop.txt#${tag}]\nSWAP 2.=2:\n+line2`;

    const first = await tool.execute("tc_1", { input: noopInput });
    expect(getTextContent(first)).toContain("re-read");

    const second = await tool.execute("tc_1", { input: noopInput });
    expect(getTextContent(second)).toContain("re-read");

    await expect(tool.execute("tc_1", { input: noopInput })).rejects.toThrow(
      "in a row"
    );

    expect(readFileSync(join(tmpDir, "hl-noop.txt"), "utf-8")).toBe(content);
  });

  it("resets the counter when a non-noop edit lands on the same path", async () => {
    const content = "line1\nline2\nline3\n";
    writeFileSync(join(tmpDir, "hl-reset.txt"), content);
    const { InMemorySnapshotStore } = await import(
      "../lib/hashline-utils/snapshots"
    );
    const snapshotStore = new InMemorySnapshotStore();
    const tool = createEditTool(tmpDir, {
      mode: "hashline",
      snapshotStore,
      noopOwner: {},
    });
    const readTool = createReadTool(tmpDir, { snapshotStore });

    const readResult = await readTool.execute("tc_1", { path: "hl-reset.txt" });
    const tag = getTextContent(readResult).match(/#([0-9A-F]{4})/)?.[1];
    expect(tag).toBeDefined();
    const noopInput = `[hl-reset.txt#${tag}]\nSWAP 2.=2:\n+line2`;

    await tool.execute("tc_1", { input: noopInput });
    await tool.execute("tc_1", { input: noopInput });

    await tool.execute("tc_1", {
      input: `[hl-reset.txt#${tag}]\nSWAP 2.=2:\n+CHANGED`,
    });
    expect(readFileSync(join(tmpDir, "hl-reset.txt"), "utf-8")).toBe(
      "line1\nCHANGED\nline3\n"
    );

    const reread = await readTool.execute("tc_1", { path: "hl-reset.txt" });
    const newTag = getTextContent(reread).match(/#([0-9A-F]{4})/)?.[1];
    expect(newTag).toBeDefined();
    const newNoopInput = `[hl-reset.txt#${newTag}]\nSWAP 2.=2:\n+CHANGED`;

    await tool.execute("tc_1", { input: newNoopInput });
    await tool.execute("tc_1", { input: newNoopInput });
    await expect(tool.execute("tc_1", { input: newNoopInput })).rejects.toThrow(
      "in a row"
    );
  });

  it("does not escalate when no noopOwner is provided", async () => {
    const content = "line1\nline2\nline3\n";
    writeFileSync(join(tmpDir, "hl-noowner.txt"), content);
    const { InMemorySnapshotStore } = await import(
      "../lib/hashline-utils/snapshots"
    );
    const snapshotStore = new InMemorySnapshotStore();
    const tag = snapshotStore.record(join(tmpDir, "hl-noowner.txt"), content);
    const tool = createEditTool(tmpDir, {
      mode: "hashline",
      snapshotStore,
    });
    const noopInput = `[hl-noowner.txt#${tag}]\nSWAP 2.=2:\n+line2`;

    for (let i = 0; i < 5; i++) {
      const result = await tool.execute("tc_1", { input: noopInput });
      expect(getTextContent(result)).toContain("re-read");
    }
  });
});

describe("EditTool (hashline block edits)", () => {
  it("applies SWAP.BLK via the native block resolver", async () => {
    const content =
      "function f() {\n  const a = 1\n  const b = 2\n}\n// trailer\n";
    writeFileSync(join(tmpDir, "fn-blk-swap.ts"), content);
    const { InMemorySnapshotStore } = await import(
      "../lib/hashline-utils/snapshots"
    );
    const snapshotStore = new InMemorySnapshotStore();
    const tag = snapshotStore.record(join(tmpDir, "fn-blk-swap.ts"), content);
    const tool = createEditTool(tmpDir, {
      mode: "hashline",
      snapshotStore,
    });
    const result = await tool.execute("tc_1", {
      input: `[fn-blk-swap.ts#${tag}]\nSWAP.BLK 1:\n+function g() {\n+  return 42\n+}`,
    });
    expect(getTextContent(result)).toContain("[fn-blk-swap.ts#");
    expect(readFileSync(join(tmpDir, "fn-blk-swap.ts"), "utf-8")).toBe(
      "function g() {\n  return 42\n}\n// trailer\n"
    );
  });

  it("applies DEL.BLK via the native block resolver", async () => {
    const content =
      "function f() {\n  const a = 1\n  const b = 2\n}\n// trailer\n";
    writeFileSync(join(tmpDir, "fn-blk-del.ts"), content);
    const { InMemorySnapshotStore } = await import(
      "../lib/hashline-utils/snapshots"
    );
    const snapshotStore = new InMemorySnapshotStore();
    const tag = snapshotStore.record(join(tmpDir, "fn-blk-del.ts"), content);
    const tool = createEditTool(tmpDir, {
      mode: "hashline",
      snapshotStore,
    });
    await tool.execute("tc_1", {
      input: `[fn-blk-del.ts#${tag}]\nDEL.BLK 1`,
    });
    expect(readFileSync(join(tmpDir, "fn-blk-del.ts"), "utf-8")).toBe(
      "// trailer\n"
    );
  });

  it("applies INS.BLK.POST after the resolved block", async () => {
    const content =
      "function f() {\n  const a = 1\n  const b = 2\n}\n// trailer\n";
    writeFileSync(join(tmpDir, "fn-blk-ins.ts"), content);
    const { InMemorySnapshotStore } = await import(
      "../lib/hashline-utils/snapshots"
    );
    const snapshotStore = new InMemorySnapshotStore();
    const tag = snapshotStore.record(join(tmpDir, "fn-blk-ins.ts"), content);
    const tool = createEditTool(tmpDir, {
      mode: "hashline",
      snapshotStore,
    });
    await tool.execute("tc_1", {
      input: `[fn-blk-ins.ts#${tag}]\nINS.BLK.POST 1:\n+export const x = 1`,
    });
    expect(readFileSync(join(tmpDir, "fn-blk-ins.ts"), "utf-8")).toBe(
      "function f() {\n  const a = 1\n  const b = 2\n}\nexport const x = 1\n// trailer\n"
    );
  });

  it("rejects SWAP.BLK on a single-line statement", async () => {
    const content = "const x = 1\n";
    writeFileSync(join(tmpDir, "fn-blk-single.ts"), content);
    const { InMemorySnapshotStore } = await import(
      "../lib/hashline-utils/snapshots"
    );
    const snapshotStore = new InMemorySnapshotStore();
    const tag = snapshotStore.record(join(tmpDir, "fn-blk-single.ts"), content);
    const tool = createEditTool(tmpDir, {
      mode: "hashline",
      snapshotStore,
    });
    await expect(
      tool.execute("tc_1", {
        input: `[fn-blk-single.ts#${tag}]\nSWAP.BLK 1:\n+const y = 2`,
      })
    ).rejects.toThrow(/single-line block/);
    expect(readFileSync(join(tmpDir, "fn-blk-single.ts"), "utf-8")).toBe(
      content
    );
  });
});

describe("BashTool", () => {
  it("runs a command and returns output", async () => {
    const tool = createBashTool(tmpDir);
    const result = await tool.execute("tc_1", { command: "echo hello" });
    expect(getTextContent(result).trim()).toBe("hello");
  });

  it("returns error on non-zero exit", async () => {
    const tool = createBashTool(tmpDir);
    await expect(tool.execute("tc_1", { command: "exit 1" })).rejects.toThrow(
      "exited with code 1"
    );
  });

  it("times out", async () => {
    const tool = createBashTool(tmpDir);
    await expect(
      tool.execute("tc_1", { command: "sleep 10", timeout: 0.1 })
    ).rejects.toThrow("timed out");
  });

  it("streams output via onUpdate callback", async () => {
    const updates: string[] = [];
    const tool = createBashTool(tmpDir);
    const result = await tool.execute(
      "tc_1",
      { command: "for i in 1 2 3; do echo $i; sleep 0.1; done" },
      undefined,
      (update) => {
        const text = getTextContent(update);
        if (text) {
          updates.push(text);
        }
      }
    );
    expect(getTextContent(result)).toContain("3");
    expect(updates.length).toBeGreaterThanOrEqual(2);
  });

  it("respects abort signal and returns promptly", async () => {
    const controller = new AbortController();
    const tool = createBashTool(tmpDir);
    const start = Date.now();
    const promise = tool.execute(
      "tc_1",
      { command: "sleep 30" },
      controller.signal
    );
    setTimeout(() => controller.abort(), 100);
    await expect(promise).rejects.toThrow();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);
  });

  it("does not block the event loop", async () => {
    let otherWorkRan = false;
    const tool = createBashTool(tmpDir);
    const promise = tool.execute("tc_1", { command: "sleep 0.3" });
    otherWorkRan = true;
    const result = await promise;
    expect(otherWorkRan).toBe(true);
    expect(result).toBeDefined();
  });
});

describe("GrepTool", () => {
  it("searches for a pattern in files", async () => {
    writeFileSync(
      join(tmpDir, "grep-test.ts"),
      "const TODO = 1;\nconst done = 2;\n"
    );
    const tool = createGrepTool(tmpDir);
    const result = await tool.execute("tc_1", { pattern: "TODO" });
    expect(getTextContent(result)).toContain("TODO");
  });

  it("supports ignoreCase", async () => {
    writeFileSync(join(tmpDir, "case.ts"), "hello HELLO Hello");
    const tool = createGrepTool(tmpDir);
    const result = await tool.execute("tc_1", {
      pattern: "hello",
      ignoreCase: true,
    });
    const text = getTextContent(result);
    expect(text).toContain("hello");
    expect(text).toContain("HELLO");
  });

  it("returns no matches message when nothing found", async () => {
    const tool = createGrepTool(tmpDir);
    const result = await tool.execute("tc_1", { pattern: "XYZNONEXISTENT" });
    expect(getTextContent(result)).toContain("No matches found");
  });
});

describe("FindTool", () => {
  const createTestFindTool = () =>
    createFindTool(tmpDir, {
      operations: {
        exists: async (p: string) => {
          try {
            const { stat } = await import("node:fs/promises");
            await stat(p);
            return true;
          } catch {
            return false;
          }
        },
        glob: (
          pattern: string,
          cwd: string,
          _opts: { ignore: string[]; limit: number }
        ) =>
          globSync(pattern, { cwd, exclude: _opts.ignore }).map((p) =>
            resolve(cwd, p)
          ),
      },
    });

  it("finds files by pattern", async () => {
    writeFileSync(join(tmpDir, "found.ts"), "x");
    writeFileSync(join(tmpDir, "found2.ts"), "y");
    writeFileSync(join(tmpDir, "found.js"), "z");
    const tool = createTestFindTool();
    const result = await tool.execute("tc_1", { pattern: "*.ts" });
    const text = getTextContent(result);
    expect(text).toContain("found.ts");
    expect(text).toContain("found2.ts");
    expect(text).not.toContain("found.js");
  });

  it("returns no files found when empty", async () => {
    const tool = createTestFindTool();
    const result = await tool.execute("tc_1", { pattern: "*.nonexistent" });
    expect(getTextContent(result)).toContain("No files found");
  });
});

describe("LsTool", () => {
  it("lists current directory", async () => {
    const tool = createLsTool(tmpDir);
    const result = await tool.execute("tc_1", {});
    const text = getTextContent(result);
    expect(text).toContain("hello.txt");
  });

  it("lists subdirectory with / suffix for dirs", async () => {
    mkdirSync(join(tmpDir, "subdir"));
    writeFileSync(join(tmpDir, "subdir", "file.txt"), "x");
    const tool = createLsTool(tmpDir);
    const result = await tool.execute("tc_1", { path: "subdir" });
    expect(getTextContent(result)).toContain("file.txt");
  });
});

describe("Tool Argument Validation", () => {
  it("read rejects missing path", async () => {
    const tool = createReadTool(tmpDir);
    await expect(tool.execute("tc_1", {} as any)).rejects.toThrow();
  });

  it("bash rejects missing command", async () => {
    const tool = createBashTool(tmpDir);
    await expect(tool.execute("tc_1", {} as any)).rejects.toThrow();
  });

  it("edit rejects missing path", async () => {
    const tool = createEditTool(tmpDir);
    await expect(
      tool.execute("tc_1", {
        edits: [{ oldText: "x", newText: "y" }],
      } as any)
    ).rejects.toThrow();
  });

  it("bash ignores wrong type for timeout (handled by harness)", async () => {
    const tool = createBashTool(tmpDir);
    const result = await tool.execute("tc_1", {
      command: "echo hi",
      timeout: "ten" as unknown as number,
    });
    expect(getTextContent(result).trim()).toBe("hi");
  });
});

describe("Tool Safety", () => {
  it("detects image by magic bytes regardless of extension", async () => {
    const minimalPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
      "base64"
    );
    writeFileSync(join(tmpDir, "image.dat"), minimalPng);
    const tool = createReadTool(tmpDir);
    const result = await tool.execute("tc_1", { path: "image.dat" });
    const text = getTextContent(result);
    expect(text).toContain("image/png");
    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "image", mimeType: "image/png" }),
      ])
    );
  });

  it("grep pattern cannot inject flags", async () => {
    writeFileSync(join(tmpDir, "secret.txt"), "password123\n-i hello\n");
    const tool = createGrepTool(tmpDir);
    const result = await tool.execute("tc_1", { pattern: "-i password" });
    const text = getTextContent(result);
    expect(text).not.toContain("password123");
  });

  it("edit is atomic: if 2nd edit fails, file is unchanged", async () => {
    writeFileSync(join(tmpDir, "atomic.txt"), "alpha\nbeta\ngamma\n");
    const tool = createEditTool(tmpDir);
    const original = readFileSync(join(tmpDir, "atomic.txt"), "utf-8");
    await expect(
      tool.execute("tc_1", {
        path: "atomic.txt",
        edits: [
          { oldText: "alpha", newText: "ALPHA" },
          { oldText: "nonexistent", newText: "fail" },
        ],
      })
    ).rejects.toThrow();
    expect(readFileSync(join(tmpDir, "atomic.txt"), "utf-8")).toBe(original);
  });

  it("bash captures stderr output", async () => {
    const tool = createBashTool(tmpDir);
    const result = await tool.execute("tc_1", {
      command: "echo stdout-msg; echo stderr-msg 1>&2",
    });
    const text = getTextContent(result);
    expect(text).toContain("stdout-msg");
    expect(text).toContain("stderr-msg");
  });
});
