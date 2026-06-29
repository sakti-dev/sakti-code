import { describe, expect, it } from "vite-plus/test";
import { computeFileHash, computeRawHash } from "../format";

describe("computeRawHash", () => {
  it("is deterministic", () => {
    expect(computeRawHash("hello\nworld\n")).toBe(
      computeRawHash("hello\nworld\n")
    );
  });

  it("returns a lowercase hex string up to 8 chars (32-bit)", () => {
    const result = computeRawHash("anything");
    expect(result).toMatch(/^[0-9a-f]{1,8}$/);
  });

  it("does NOT normalize trailing whitespace before hashing", () => {
    expect(computeRawHash("foo\n")).not.toBe(computeRawHash("foo  \n"));
    expect(computeRawHash("bar")).not.toBe(computeRawHash("bar\t"));
  });

  it("distinguishes payloads that computeFileHash collapses (whitespace-only delta)", () => {
    const a = "SWAP 1.=1:\nfoo";
    const b = "SWAP 1.=1:\nfoo   ";
    expect(computeFileHash(a)).toBe(computeFileHash(b));
    expect(computeRawHash(a)).not.toBe(computeRawHash(b));
  });

  it("produces different hashes for different content", () => {
    expect(computeRawHash("alpha")).not.toBe(computeRawHash("beta"));
  });
});
