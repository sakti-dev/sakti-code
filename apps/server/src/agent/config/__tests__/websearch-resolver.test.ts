import { afterEach, describe, expect, it, vi } from "vite-plus/test";
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

/** Empty ok JSON response for each provider's expected shape. */
function stubEmptyOk(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response('{"result":{"content":[{"type":"text","text":"[]"}]}}', {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
}

describe("resolveWebSearchOperations", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses Exa when provider=exa and a key is present", async () => {
    stubEmptyOk();
    const { auth, settings } = setup({ provider: "exa" }, { "websearch:exa": "k" });
    const out = await resolveWebSearchOperations(auth, settings).search("q", {
      numResults: 1,
      signal: new AbortController().signal,
    });
    expect(out.provider).toBe("exa");
  });

  it("falls back to DDG when provider=exa but no key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html></html>", { status: 200 })),
    );
    const { auth, settings } = setup({ provider: "exa" });
    const out = await resolveWebSearchOperations(auth, settings).search("q", {
      numResults: 1,
      signal: new AbortController().signal,
    });
    expect(out.provider).toBe("ddg");
  });

  it("uses Tavily when provider=tavily and a key is present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"results":[]}', { status: 200 })),
    );
    const { auth, settings } = setup({ provider: "tavily" }, { "websearch:tavily": "k" });
    const out = await resolveWebSearchOperations(auth, settings).search("q", {
      numResults: 1,
      signal: new AbortController().signal,
    });
    expect(out.provider).toBe("tavily");
  });

  it("defaults to DDG when provider is absent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html></html>", { status: 200 })),
    );
    const { auth, settings } = setup(undefined);
    const out = await resolveWebSearchOperations(auth, settings).search("q", {
      numResults: 1,
      signal: new AbortController().signal,
    });
    expect(out.provider).toBe("ddg");
  });

  it("defaults to DDG when provider is unknown", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html></html>", { status: 200 })),
    );
    const { auth, settings } = setup({ provider: "brave" });
    const out = await resolveWebSearchOperations(auth, settings).search("q", {
      numResults: 1,
      signal: new AbortController().signal,
    });
    expect(out.provider).toBe("ddg");
  });
});
