# Provider Auth Parity Corrections Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.
> **TDD Mode:** Write failing tests first, verify failure, then implement minimal code to pass.

**Goal:** Achieve OpenCode-auth parity for provider connection methods by ensuring OAuth is only exposed/handled for the same providers OpenCode supports, while `opencode`, `zai`, and `zai-coding-plan` remain API-key based.

**Architecture:** Keep the registry-based auth system, but tighten method-source truth: provider auth methods come from explicit provider definitions that mirror OpenCode behavior. Server enforces method validity; desktop renders only server-declared methods. Remove confusing provider-specific OAuth behavior for `zai` and ensure UX copy and flows match OpenCode semantics.

**Tech Stack:** TypeScript, Hono, SolidJS, Vitest, OpenAPI schema generation, unstorage (`fs-lite`), pnpm.

---

## Scope

- In scope:
  - Auth method parity and method gating by provider.
  - OAuth authorize/callback behavior parity for supported OAuth providers.
  - Desktop provider settings UX parity for method presentation/copy.
  - Tests for registry, routes, OAuth flows, and desktop rendering.

- Out of scope:
  - Plugin loading compatibility runtime (future task).
  - New providers not present in current catalog.
  - Refactors unrelated to provider auth and connection UX.

## OpenCode Alignment Sources (must be checked each phase)

- `opencode/packages/opencode/src/cli/cmd/auth.ts`
- `opencode/packages/app/src/components/dialog-connect-provider.tsx`
- `opencode/packages/app/src/components/settings-providers.tsx`
- `opencode/packages/plugin/src/index.ts`
- `opencode/packages/opencode/src/server/routes/provider.ts`

## Acceptance Criteria

- `zai`, `zai-coding-plan`, and `opencode` show API-key method only.
- No UI string suggests "Connect with Zen" for `zai`.
- OAuth actions (`authorize`/`callback`) work only for providers whose methods are `oauth`.
- Desktop renders methods exactly from server method list; no client-side method invention.
- All targeted tests pass; typecheck and lint pass.

---

## Task 1: Verify Registry Method Matrix (Consolidated Server Tests)

> **Status:** Pending
> **TDD Phase:** RED (verify tests exist and pass for correct behavior)

**Rationale:** The registry already returns correct API-only methods for `zai`, `opencode`, `zai-coding-plan`. This task verifies and expands coverage.

**Files:**

- Modify: `packages/server/tests/provider/auth.registry.test.ts`
- Modify: `packages/server/tests/provider/auth.providers.test.ts`

**Step 1: Expand test coverage for full matrix**

Add to `auth.registry.test.ts`:

```ts
it("returns api-only methods for zai, zai-coding-plan, and opencode", () => {
  const methods = listProviderAuthMethods(["zai", "zai-coding-plan", "opencode"]);
  expect(methods.zai).toEqual([{ type: "api", label: "API Key", prompts: undefined }]);
  expect(methods["zai-coding-plan"]).toEqual([
    { type: "api", label: "API Key", prompts: undefined },
  ]);
  expect(methods.opencode).toEqual([{ type: "api", label: "API Key", prompts: undefined }]);
});

it("returns oauth-capable methods only for openai/github-copilot/anthropic", () => {
  const methods = listProviderAuthMethods(["openai", "github-copilot", "anthropic"]);
  expect(methods.openai.some(m => m.type === "oauth")).toBe(true);
  expect(methods["github-copilot"].some(m => m.type === "oauth")).toBe(true);
  expect(methods.anthropic.some(m => m.type === "oauth")).toBe(true);
});
```

Add to `auth.providers.test.ts`:

```ts
it("does not register zai, zai-coding-plan, or opencode in builtins", () => {
  const definitions = createBuiltinProviderAuthDefinitions();
  const providerIds = definitions.map(d => d.providerId);
  expect(providerIds).not.toContain("zai");
  expect(providerIds).not.toContain("zai-coding-plan");
  expect(providerIds).not.toContain("opencode");
});
```

**Step 2: Run and verify tests pass**

```bash
pnpm --filter @sakti-code/server test -- packages/server/tests/provider/auth.registry.test.ts
pnpm --filter @sakti-code/server test -- packages/server/tests/provider/auth.providers.test.ts
```

Expected: PASS (registry already correct)

**Step 3: Commit**

```bash
git add packages/server/tests/provider/auth.registry.test.ts \
  packages/server/tests/provider/auth.providers.test.ts
git commit -m "test(provider-auth): verify api-only methods for zai/opencode/zai-coding-plan"
```

---

## Task 2: Add OAuth Rejection Tests

> **Status:** Pending
> **TDD Phase:** RED → GREEN

**Rationale:** OAuth gate in `oauth.ts:35-38` already throws for non-OAuth methods. Add explicit tests for `zai`, `opencode`, `zai-coding-plan`.

**Files:**

- Modify: `packages/server/tests/provider/oauth.openai.test.ts`

**Step 1: Write failing test for OAuth rejection**

Add to `oauth.openai.test.ts`:

```ts
it("rejects oauth authorize for api-only providers", async () => {
  await expect(startOAuth({ providerId: "zai", method: 0 })).rejects.toThrow(
    /Invalid oauth method/
  );
  await expect(startOAuth({ providerId: "opencode", method: 0 })).rejects.toThrow(
    /Invalid oauth method/
  );
  await expect(startOAuth({ providerId: "zai-coding-plan", method: 0 })).rejects.toThrow(
    /Invalid oauth method/
  );
});
```

**Step 2: Verify test fails (RED)**

```bash
pnpm --filter @sakti-code/server test -- packages/server/tests/provider/oauth.openai.test.ts
```

Expected: Test should PASS (gate already exists) - this is verification, not new implementation.

**Step 3: Commit**

```bash
git add packages/server/tests/provider/oauth.openai.test.ts
git commit -m "test(provider-auth): add oauth rejection tests for api-only providers"
```

---

## Task 3: Desktop Test Fixes (In-Place + New)

> **Status:** Pending
> **TDD Phase:** RED → GREEN

**Rationale:** Existing desktop tests incorrectly use `zai` with OAuth. Fix to use `openai` and add new parity tests.

**Files:**

- Modify: `apps/desktop/tests/unit/views/provider-settings.test.tsx`

**Step 1: Fix existing "runs oauth auto flow" test**

Change mock from `zai` to `openai`:

```tsx
// Lines 166-236
it("runs oauth auto flow from provider modal", async () => {
  const openExternal = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(window, "saktiCodeAPI", {
    configurable: true,
    value: { shell: { openExternal } },
  });

  const client: ProviderClient = {
    listProviders: vi.fn().mockResolvedValue([{ id: "openai", name: "OpenAI" }]),
    listAuthMethods: vi.fn().mockResolvedValue({
      openai: [{ type: "oauth", label: "ChatGPT Pro/Plus (browser)" }],
    }),
    listAuthStates: vi.fn().mockResolvedValue({
      openai: {
        providerId: "openai",
        status: "disconnected",
        method: "oauth",
        accountLabel: null,
        updatedAt: "2026-02-14T11:00:00.000Z",
      },
    }),
    listModels: vi.fn().mockResolvedValue([]),
    setToken: vi.fn().mockResolvedValue(undefined),
    clearToken: vi.fn().mockResolvedValue(undefined),
    oauthAuthorize: vi.fn().mockResolvedValue({
      providerId: "openai",
      authorizationId: "oauth-1",
      url: "https://example.com/oauth",
      method: "auto",
      instructions: "Use browser",
    }),
    oauthCallback: vi.fn().mockResolvedValue({ status: "connected" }),
    getPreferences: vi.fn().mockResolvedValue({
      selectedProviderId: null,
      selectedModelId: null,
      hybridEnabled: true,
      hybridVisionProviderId: null,
      hybridVisionModelId: null,
      updatedAt: "2026-02-14T11:00:00.000Z",
    }),
    updatePreferences: vi.fn(),
  };

  dispose = render(() => <ProviderSettings client={client} />, container);
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));

  const openModalButton = Array.from(container.querySelectorAll("button")).find(b =>
    b.textContent?.includes("Connect a provider")
  ) as HTMLButtonElement;
  openModalButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 0));

  const connectOAuthButton = Array.from(container.querySelectorAll("button")).find(b =>
    b.textContent?.includes("ChatGPT Pro/Plus (browser)")
  ) as HTMLButtonElement;
  connectOAuthButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));

  expect(client.oauthAuthorize).toHaveBeenCalledWith("openai", 0);
  expect(openExternal).toHaveBeenCalledWith("https://example.com/oauth");
  expect(client.oauthCallback).toHaveBeenCalledWith("openai", 0, "oauth-1");
});
```

**Step 2: Fix "shows oauth error" test similarly**

Change mock from `zai` to `openai` in lines 238-288.

**Step 3: Add new parity test for API-only providers**

```tsx
it("renders only API key input for api-only providers without oauth button", async () => {
  const client: ProviderClient = {
    listProviders: vi.fn().mockResolvedValue([
      { id: "zai", name: "Z.AI" },
      { id: "opencode", name: "OpenCode" },
      { id: "zai-coding-plan", name: "Z.AI Coding Plan" },
    ]),
    listAuthMethods: vi.fn().mockResolvedValue({
      zai: [{ type: "api", label: "API Key" }],
      opencode: [{ type: "api", label: "API Key" }],
      "zai-coding-plan": [{ type: "api", label: "API Key" }],
    }),
    listAuthStates: vi.fn().mockResolvedValue({
      zai: {
        providerId: "zai",
        status: "disconnected",
        method: "token",
        accountLabel: null,
        updatedAt: "2026-02-14T11:00:00.000Z",
      },
      opencode: {
        providerId: "opencode",
        status: "disconnected",
        method: "token",
        accountLabel: null,
        updatedAt: "2026-02-14T11:00:00.000Z",
      },
      "zai-coding-plan": {
        providerId: "zai-coding-plan",
        status: "disconnected",
        method: "token",
        accountLabel: null,
        updatedAt: "2026-02-14T11:00:00.000Z",
      },
    }),
    listModels: vi.fn().mockResolvedValue([]),
    setToken: vi.fn().mockResolvedValue(undefined),
    clearToken: vi.fn().mockResolvedValue(undefined),
    oauthAuthorize: vi.fn(),
    oauthCallback: vi.fn(),
    getPreferences: vi.fn().mockResolvedValue({
      selectedProviderId: null,
      selectedModelId: null,
      hybridEnabled: true,
      hybridVisionProviderId: null,
      hybridVisionModelId: null,
      updatedAt: "2026-02-14T11:00:00.000Z",
    }),
    updatePreferences: vi.fn(),
  };

  dispose = render(() => <ProviderSettings client={client} />, container);
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));

  const openModalButton = Array.from(container.querySelectorAll("button")).find(b =>
    b.textContent?.includes("Connect a provider")
  ) as HTMLButtonElement;
  openModalButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 0));

  // Verify zai has API input only
  const zaiOption = container.querySelector(
    '[data-testid="provider-option-zai"]'
  ) as HTMLButtonElement;
  expect(zaiOption).toBeTruthy();
  zaiOption.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 0));

  const apiInput = container.querySelector('input[placeholder="API key"]');
  expect(apiInput).toBeTruthy();

  // Should NOT have oauth button
  const oauthButtons = Array.from(container.querySelectorAll("button")).filter(b =>
    /oauth|connect with zen/i.test(b.textContent || "")
  );
  expect(oauthButtons.length).toBe(0);
});
```

**Step 4: Run desktop tests**

```bash
pnpm --filter @sakti-code/desktop test:run -- apps/desktop/tests/unit/views/provider-settings.test.tsx
```

**Step 5: Commit**

```bash
git add apps/desktop/tests/unit/views/provider-settings.test.tsx
git commit -m "fix(desktop): correct oauth test provider and add api-only parity tests"
```

---

## Task 4: Route Contract Verification

> **Status:** Pending
> **TDD Phase:** Verification

**Files:**

- Modify: `packages/server/tests/routes/provider.routes.test.ts`

**Step 1: Expand existing test to include `zai-coding-plan`**

```ts
// Line 200-218: expand existing test
it("does not expose oauth methods for opencode, zai, and zai-coding-plan", async () => {
  const providerRouter = (await import("../../src/routes/provider")).default;
  const methods = await providerRouter.request("http://localhost/api/providers/auth/methods");
  expect(methods.status).toBe(200);
  const body = await methods.json();

  expect(Array.isArray(body.opencode)).toBe(true);
  expect(Array.isArray(body.zai)).toBe(true);
  expect(body.opencode.some((m: { type: string }) => m.type === "oauth")).toBe(false);
  expect(body.zai.some((m: { type: string }) => m.type === "oauth")).toBe(false);

  // Check zai-coding-plan if present
  if (body["zai-coding-plan"]) {
    expect(body["zai-coding-plan"].some((m: { type: string }) => m.type === "oauth")).toBe(false);
  }
});
```

**Step 2: Run route tests**

```bash
pnpm --filter @sakti-code/server test -- packages/server/tests/routes/provider.routes.test.ts
```

**Step 3: Commit**

```bash
git add packages/server/tests/routes/provider.routes.test.ts
git commit -m "test(provider-auth): add zai-coding-plan to oauth method rejection tests"
```

---

## Task 5: Full Verification Before Completion

> **Status:** Pending
> **TDD Phase:** Final GREEN verification

**Step 1: Run all server provider/auth tests**

```bash
pnpm --filter @sakti-code/server test -- packages/server/tests/provider
pnpm --filter @sakti-code/server test -- packages/server/tests/routes/provider.routes.test.ts
```

Expected: all pass.

**Step 2: Run all desktop targeted tests**

```bash
pnpm --filter @sakti-code/desktop test:run -- apps/desktop/tests/unit/views/provider-settings.test.tsx
```

Expected: all pass.

**Step 3: Run global typecheck and lint**

```bash
pnpm typecheck
pnpm lint
```

Expected: all pass.

**Step 4: Final commit (if any remaining changes)**

```bash
git add -A
git commit -m "feat(provider-auth): complete opencode parity for auth method handling"
```

---

## Summary of Refined Scope

| Task   | Original                          | Refined                                |
| ------ | --------------------------------- | -------------------------------------- |
| Task 1 | Write new registry tests          | Verify/expand existing tests           |
| Task 2 | Implement registry changes        | **Merged into Task 1**                 |
| Task 3 | New OAuth test files              | Add to existing `oauth.openai.test.ts` |
| Task 4 | Desktop UI implementation changes | Fix tests in-place + add parity test   |
| Task 5 | Contract tests                    | Add `zai-coding-plan` to existing      |
| Task 6 | Full verification                 | Combined into Task 5                   |

## Risks and Mitigations

- Risk: OpenCode changes provider OAuth behavior upstream.
- Mitigation: keep parity tests referencing concrete provider matrix; add a periodic parity review checklist.

- Risk: Desktop fallback logic re-introduces inferred methods.
- Mitigation: tests assert method lists are server-driven.

## Defaults / Assumptions

- `opencode`, `zai`, and `zai-coding-plan` are API-key auth providers.
- OAuth support remains only for providers explicitly defined in server auth provider modules (`openai`, `github-copilot`, `anthropic`).
- Existing `packages/zai` provider runtime integration remains unchanged.
- No migration needed for stored credentials; method interpretation changes only at connect-time UX/flow.
