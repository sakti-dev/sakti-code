import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { type AuthStore, createAuthStore } from "../auth-store.ts";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "sakti-auth-test-"));
}

describe("AuthStore", () => {
  let dir: string;
  let authPath: string;
  let store: AuthStore;

  beforeEach(() => {
    dir = makeTmpDir();
    authPath = join(dir, "auth.json");
    store = createAuthStore(authPath);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("list returns masked entries for all known providers when empty", () => {
    const list = store.list();
    expect(list.length).toBeGreaterThan(0);
    for (const entry of list) {
      expect(entry.hasKey).toBe(false);
      expect(entry.maskedKey).toBeNull();
      expect(entry.provider).toBeTruthy();
    }
  });

  it("set then list round-trips masked", () => {
    const ok = store.set("openai", "sk-test-1234567890abcdef");
    expect(ok).toBe(true);

    const list = store.list();
    const openai = list.find((e) => e.provider === "openai");
    expect(openai?.hasKey).toBe(true);
    expect(openai?.maskedKey).toBe("...cdef");
  });

  it("delete removes the key", () => {
    store.set("openai", "sk-test-1234567890abcdef");
    const deleted = store.delete("openai");
    expect(deleted).toBe(true);

    const openai = store.list().find((e) => e.provider === "openai");
    expect(openai?.hasKey).toBe(false);
  });

  it("delete returns false for missing provider", () => {
    expect(store.delete("openai")).toBe(false);
  });

  it("getApiKey returns the stored key", () => {
    store.set("openai", "sk-test-1234567890abcdef");
    expect(store.getApiKey("openai")).toBe("sk-test-1234567890abcdef");
  });

  it("getApiKey returns undefined after delete", () => {
    store.set("openai", "sk-test-1234567890abcdef");
    store.delete("openai");
    expect(store.getApiKey("openai")).toBeUndefined();
  });

  it("getApiKey returns undefined for a provider with no stored key", () => {
    expect(store.getApiKey("openai")).toBeUndefined();
  });

  it("set then list round-trips for a provider not in the old hardcoded list", () => {
    store.set("zai", "sk-zai-test-1234567890");
    const zai = store.list().find((e) => e.provider === "zai");
    expect(zai?.hasKey).toBe(true);
    expect(zai?.maskedKey).toBe("...7890");
  });

  it("unknown provider is rejected", () => {
    const ok = store.set("bogus", "key");
    expect(ok).toBe(false);
    expect(existsSync(authPath) ? readFileSync(authPath, "utf-8") : "{}").toBe("{}");
  });

  it("empty key is rejected", () => {
    const ok = store.set("openai", "   ");
    expect(ok).toBe(false);
    expect(existsSync(authPath) ? readFileSync(authPath, "utf-8") : "{}").toBe("{}");
  });

  it("auth.json created with mode 0o600", () => {
    store.set("openai", "sk-test-1234567890abcdef");
    // biome-ignore lint/suspicious/noBitwiseOperators: file permission bit mask
    const mode = statSync(authPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("parent dir created with mode 0o700", () => {
    const nestedPath = join(dir, "nested", "deep", "auth.json");
    const nestedStore = createAuthStore(nestedPath);
    nestedStore.set("openai", "sk-test-key-1234567890");
    // biome-ignore lint/suspicious/noBitwiseOperators: file permission bit mask
    const mode = statSync(join(dir, "nested")).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  it("concurrent writes are serialized", () => {
    const store2 = createAuthStore(authPath);
    store.set("openai", "sk-key-one-1234567890");
    store2.set("anthropic", "sk-ant-key-1234567890");

    const raw = JSON.parse(readFileSync(authPath, "utf-8")) as Record<string, string>;
    expect(raw.openai).toBe("sk-key-one-1234567890");
    expect(raw.anthropic).toBe("sk-ant-key-1234567890");
  });
});
