import { describe, expect, it } from "vite-plus/test";
import { collectBoundedBody } from "../bounded-body.ts";

function makeStream(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

const enc = new TextEncoder();

describe("collectBoundedBody", () => {
  it("concatenates chunks under the limit", async () => {
    const out = await collectBoundedBody(makeStream(enc.encode("ab"), enc.encode("cd")), 100);
    expect(new TextDecoder().decode(out)).toBe("abcd");
  });

  it("returns an empty array for an empty stream", async () => {
    const out = await collectBoundedBody(makeStream(), 100);
    expect(out.byteLength).toBe(0);
  });

  it("throws when the body exceeds the limit", async () => {
    await expect(collectBoundedBody(makeStream(enc.encode("hello")), 3)).rejects.toThrow(
      /Response too large/,
    );
  });

  it("accepts a body exactly at the limit", async () => {
    const out = await collectBoundedBody(makeStream(enc.encode("abc")), 3);
    expect(new TextDecoder().decode(out)).toBe("abc");
  });
});
