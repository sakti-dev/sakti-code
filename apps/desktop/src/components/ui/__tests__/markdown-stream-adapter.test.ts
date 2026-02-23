import { createMarkdownStreamAdapter } from "@/components/ui/markdown-stream-adapter";
import { describe, expect, it } from "vitest";

describe("markdown-stream-adapter", () => {
  it("appends only deltas for monotonic snapshots", async () => {
    const adapter = createMarkdownStreamAdapter();
    adapter.update("hello", true);
    adapter.update("hello world", true);
    adapter.finish();

    const out: string[] = [];
    for await (const chunk of adapter.stream()) out.push(chunk);
    expect(out).toEqual(["hello", " world"]);
  });

  it("resets stream when snapshot rewinds", async () => {
    const adapter = createMarkdownStreamAdapter();
    adapter.update("abc", true);
    adapter.update("a", true);
    adapter.finish();

    const out: string[] = [];
    for await (const chunk of adapter.stream()) out.push(chunk);
    expect(out[out.length - 1]).toBe("a");
  });

  it("finish is idempotent", async () => {
    const adapter = createMarkdownStreamAdapter();
    adapter.update("x", true);
    adapter.finish();
    adapter.finish();
    const out: string[] = [];
    for await (const chunk of adapter.stream()) out.push(chunk);
    expect(out).toEqual(["x"]);
  });

  it("dispose closes stream without throwing", async () => {
    const adapter = createMarkdownStreamAdapter();
    adapter.update("x", true);
    expect(() => adapter.dispose()).not.toThrow();
  });
});
