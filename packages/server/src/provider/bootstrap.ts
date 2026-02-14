import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

interface CredentialProfileBootstrap {
  schemaVersion: 1;
  profileId: string;
  seededAt: string;
}

function buildBootstrap(profileId: string): CredentialProfileBootstrap {
  return {
    schemaVersion: 1,
    profileId,
    seededAt: new Date().toISOString(),
  };
}

function profileDir(baseDir: string, profileId: string): string {
  return join(baseDir, "profiles", profileId);
}

function bootstrapPath(baseDir: string, profileId: string): string {
  return join(profileDir(baseDir, profileId), "bootstrap.json");
}

export async function ensureCredentialProfileBootstrap(
  baseDir: string,
  profileId: string
): Promise<void> {
  const dir = profileDir(baseDir, profileId);
  const file = bootstrapPath(baseDir, profileId);
  await mkdir(dir, { recursive: true, mode: 0o700 });

  try {
    await readFile(file, "utf8");
    return;
  } catch {
    const payload = JSON.stringify(buildBootstrap(profileId), null, 2);
    await writeFile(file, payload, { mode: 0o600 });
  }
}

export function ensureCredentialProfileBootstrapSync(baseDir: string, profileId: string): void {
  const dir = profileDir(baseDir, profileId);
  const file = bootstrapPath(baseDir, profileId);

  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // Best-effort permissions hardening
  }

  if (existsSync(file)) {
    return;
  }

  writeFileSync(file, JSON.stringify(buildBootstrap(profileId), null, 2), { mode: 0o600 });
}
