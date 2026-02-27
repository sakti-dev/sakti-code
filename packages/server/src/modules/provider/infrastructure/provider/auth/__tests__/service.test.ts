import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createProviderAuthService } from "../../auth/service";
import { createProviderCredentialStorage } from "../../storage";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map(path => rm(path, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe("provider auth service", () => {
  it("stores token and returns connected auth state", async () => {
    const base = await mkdtemp(join(tmpdir(), "sakti-code-provider-auth-"));
    tempDirs.push(base);

    const auth = createProviderAuthService({
      storage: createProviderCredentialStorage({ baseDir: base }),
      profileId: "default",
    });

    await auth.setToken({ providerId: "zai", token: "token-123" });

    const state = await auth.getState("zai");

    expect(state.status).toBe("connected");
    expect(state.method).toBe("token");
    expect(state.providerId).toBe("zai");
  });

  it("clears token and returns disconnected auth state", async () => {
    const base = await mkdtemp(join(tmpdir(), "sakti-code-provider-auth-"));
    tempDirs.push(base);

    const auth = createProviderAuthService({
      storage: createProviderCredentialStorage({ baseDir: base }),
      profileId: "default",
    });

    await auth.setToken({ providerId: "zai", token: "token-123" });
    await auth.clear("zai");

    const state = await auth.getState("zai");

    expect(state.status).toBe("disconnected");
  });

  it("does not expose secret in auth state payload", async () => {
    const base = await mkdtemp(join(tmpdir(), "sakti-code-provider-auth-"));
    tempDirs.push(base);

    const auth = createProviderAuthService({
      storage: createProviderCredentialStorage({ baseDir: base }),
      profileId: "default",
    });

    await auth.setToken({ providerId: "zai", token: "super-secret-token" });

    const state = await auth.getState("zai");

    expect((state as unknown as { secret?: string }).secret).toBeUndefined();
  });

  it("stores oauth credential and reports oauth method", async () => {
    const base = await mkdtemp(join(tmpdir(), "sakti-code-provider-auth-"));
    tempDirs.push(base);

    const auth = createProviderAuthService({
      storage: createProviderCredentialStorage({ baseDir: base }),
      profileId: "default",
    });

    await auth.setOAuth({
      providerId: "zai",
      accessToken: "access-123",
      refreshToken: "refresh-123",
      expiresAt: 1890000000000,
      accountLabel: "user@example.com",
    });

    const state = await auth.getState("zai");
    expect(state.status).toBe("connected");
    expect(state.method).toBe("oauth");

    const credential = await auth.getCredential("zai");
    expect(credential?.kind).toBe("oauth");
    if (!credential || credential.kind !== "oauth") {
      throw new Error("expected oauth credential");
    }
    expect(credential.oauth.accessToken).toBe("access-123");
    expect(credential.oauth.refreshToken).toBe("refresh-123");
  });

  it("loads persisted oauth credential after service recreation", async () => {
    const base = await mkdtemp(join(tmpdir(), "sakti-code-provider-auth-"));
    tempDirs.push(base);

    const storage = createProviderCredentialStorage({ baseDir: base });
    const authA = createProviderAuthService({
      storage,
      profileId: "default",
    });

    await authA.setOAuth({
      providerId: "zai",
      accessToken: "persist-access",
      refreshToken: "persist-refresh",
      expiresAt: 1890000000000,
      accountLabel: "persisted",
    });

    const authB = createProviderAuthService({
      storage: createProviderCredentialStorage({ baseDir: base }),
      profileId: "default",
    });

    const credential = await authB.getCredential("zai");
    expect(credential?.kind).toBe("oauth");
    if (!credential || credential.kind !== "oauth") {
      throw new Error("expected oauth credential");
    }
    expect(credential.oauth.accessToken).toBe("persist-access");
    expect(credential.oauth.refreshToken).toBe("persist-refresh");
  });

  it("reports error state when persisted oauth payload is malformed", async () => {
    const base = await mkdtemp(join(tmpdir(), "sakti-code-provider-auth-"));
    tempDirs.push(base);

    const storage = createProviderCredentialStorage({ baseDir: base });
    await storage.set({
      providerId: "openai",
      profileId: "default",
      kind: "oauth",
      secret: "not-json",
      updatedAt: "2026-02-14T11:00:00.000Z",
    });

    const auth = createProviderAuthService({
      storage,
      profileId: "default",
    });

    const credential = await auth.getCredential("openai");
    const state = await auth.getState("openai");

    expect(credential).toBeNull();
    expect(state.status).toBe("error");
    expect(state.method).toBe("oauth");
  });
});
