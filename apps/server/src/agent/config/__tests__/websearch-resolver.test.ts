import { describe, expect, it } from "vite-plus/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuthStore } from "../../../lib/auth-store.ts";
import { createSettingsFileStore } from "../../../lib/settings-file-store.ts";
import { resolveWebSearchOperations } from "../websearch-resolver";

function setup(
  websearch: unknown,
  authEntries: Record<string, string> = {},
): {
  auth: ReturnType<typeof createAuthStore>;
  settings: ReturnType<typeof createSettingsFileStore>;
} {
  const dir = mkdtempSync(join(tmpdir(), "ws-resolver-"));
  const auth = createAuthStore(join(dir, "auth.json"));
  for (const [k, v] of Object.entries(authEntries)) auth.set(k, v);
  const settings = createSettingsFileStore(join(dir, "settings.json"));
  if (websearch !== undefined) settings.update({ websearch });
  return { auth, settings };
}

describe("resolveWebSearchOperations", () => {
  it("returns Exa operations when provider=exa and a key is present", () => {
    const { auth, settings } = setup({ provider: "exa" }, { "websearch:exa": "k" });
    expect(resolveWebSearchOperations(auth, settings)).toBeDefined();
  });

  it("returns undefined when provider=exa but no key (no silent fallback)", () => {
    const { auth, settings } = setup({ provider: "exa" });
    expect(resolveWebSearchOperations(auth, settings)).toBeUndefined();
  });

  it("returns Tavily operations when provider=tavily and a key is present", () => {
    const { auth, settings } = setup({ provider: "tavily" }, { "websearch:tavily": "k" });
    expect(resolveWebSearchOperations(auth, settings)).toBeDefined();
  });

  it("returns undefined when provider=tavily but no key", () => {
    const { auth, settings } = setup({ provider: "tavily" });
    expect(resolveWebSearchOperations(auth, settings)).toBeUndefined();
  });

  it("returns undefined when provider is absent", () => {
    const { auth, settings } = setup(undefined);
    expect(resolveWebSearchOperations(auth, settings)).toBeUndefined();
  });

  it("returns undefined when provider is unknown", () => {
    const { auth, settings } = setup({ provider: "brave" });
    expect(resolveWebSearchOperations(auth, settings)).toBeUndefined();
  });
});
