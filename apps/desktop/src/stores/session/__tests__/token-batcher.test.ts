import { describe, expect, it } from "vite-plus/test";
import { createTokenBatcher } from "../token-batcher.ts";

describe("token batcher", () => {
  it("accumulates deltas and flushes on microtask", async () => {
    const flushed: { id: string; text: string }[] = [];
    const batcher = createTokenBatcher((id, text) => {
      flushed.push({ id, text });
    });

    batcher.append("msg1", "Hello");
    batcher.append("msg1", " ");
    batcher.append("msg1", "World");
    batcher.append("msg2", "Other");

    expect(flushed).toHaveLength(0);

    await Promise.resolve();

    expect(flushed).toEqual([
      { id: "msg1", text: "Hello World" },
      { id: "msg2", text: "Other" },
    ]);

    batcher.dispose();
  });

  it("does not double-flush", async () => {
    const flushed: string[] = [];
    const batcher = createTokenBatcher((_, text) => flushed.push(text));

    batcher.append("msg1", "token");
    await Promise.resolve();

    expect(flushed).toEqual(["token"]);

    await Promise.resolve();
    expect(flushed).toEqual(["token"]);

    batcher.dispose();
  });

  it("dispose prevents pending flush", async () => {
    const flushed: string[] = [];
    const batcher = createTokenBatcher((_, text) => flushed.push(text));

    batcher.append("msg1", "data");
    batcher.dispose();

    await Promise.resolve();
    expect(flushed).toHaveLength(0);
  });

  it("re-append after dispose starts fresh", async () => {
    const flushed: string[] = [];
    const batcher = createTokenBatcher((_, text) => flushed.push(text));

    batcher.append("msg1", "first");
    batcher.dispose();

    batcher.append("msg2", "second");
    await Promise.resolve();

    expect(flushed).toEqual(["second"]);
  });

  it("handles empty string deltas", async () => {
    const flushed: string[] = [];
    const batcher = createTokenBatcher((_, text) => flushed.push(text));

    batcher.append("msg1", "");
    batcher.append("msg1", "a");
    batcher.append("msg1", "");
    await Promise.resolve();

    expect(flushed).toEqual(["a"]);

    batcher.dispose();
  });

  it("handles interleaved messages", async () => {
    const flushed: { id: string; text: string }[] = [];
    const batcher = createTokenBatcher((id, text) => {
      flushed.push({ id, text });
    });

    batcher.append("a", "1");
    batcher.append("b", "2");
    batcher.append("a", "3");
    batcher.append("b", "4");
    await Promise.resolve();

    const aFlush = flushed.filter((f) => f.id === "a");
    const bFlush = flushed.filter((f) => f.id === "b");
    expect(aFlush).toEqual([{ id: "a", text: "13" }]);
    expect(bFlush).toEqual([{ id: "b", text: "24" }]);

    batcher.dispose();
  });
});
