import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  createSettingsFileStore,
  type SettingsFileStore,
} from "../settings-file-store.ts";

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "sakti-settings-test-"));
}

describe("SettingsFileStore", () => {
  let dir: string;
  let filePath: string;
  let store: SettingsFileStore;

  beforeEach(() => {
    dir = makeTmpDir();
    filePath = join(dir, "settings.json");
    store = createSettingsFileStore(filePath);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("read returns empty object when file is absent", () => {
    expect(store.read()).toEqual({});
  });

  it("update then read round-trips a simple value", () => {
    store.update({ theme: "dark" });
    expect(store.read()).toEqual({ theme: "dark" });
  });

  it("update deep-merges nested objects", () => {
    store.update({ ui: { theme: "dark", sidebar: true } });
    store.update({ ui: { fontSize: 14 } });
    expect(store.read()).toEqual({
      ui: { theme: "dark", sidebar: true, fontSize: 14 },
    });
  });

  it("update replaces primitives, not arrays of merging", () => {
    store.update({ tags: ["a", "b"] });
    store.update({ tags: ["c"] });
    expect(store.read()).toEqual({ tags: ["c"] });
  });

  it("update preserves existing keys not in the partial", () => {
    store.update({ theme: "dark", lang: "en" });
    store.update({ theme: "light" });
    expect(store.read()).toEqual({ theme: "light", lang: "en" });
  });

  it("update is atomic (temp+rename)", () => {
    store.update({ theme: "dark" });
    expect(existsSync(filePath)).toBe(true);
    expect(existsSync(`${filePath}.tmp`)).toBe(false);
  });

  it("read throws on malformed JSON", () => {
    writeFileSync(filePath, "{ broken");
    expect(() => store.read()).toThrow();
  });
});
