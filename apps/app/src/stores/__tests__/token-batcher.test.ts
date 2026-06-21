import { describe, expect, it } from "vitest";
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

  it("does not flush when empty", async () => {
    const flushed: string[] = [];
    const batcher = createTokenBatcher((_, text) => flushed.push(text));

    batcher.append("msg1", "token");
    await Promise.resolve();

    expect(flushed).toEqual(["token"]);

    await Promise.resolve();
    expect(flushed).toEqual(["token"]);

    batcher.dispose();
  });
});
