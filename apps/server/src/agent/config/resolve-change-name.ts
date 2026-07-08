import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SAKTI_CHANGES_DIR } from "@sakti-code/sakti";

const SAFE_CHANGE_NAME_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

export function isSafeChangeName(name: string): boolean {
  return SAFE_CHANGE_NAME_RE.test(name);
}

/**
 * Resolve the most recently modified change name in a project's
 * `.sakti/changes/` directory. Used at plan→mission graduation to link the
 * new mission session to its SDD change (so progress-aware reminders work).
 *
 * Returns null if the changes dir doesn't exist, is empty, or contains no
 * valid change directories (directories with a `.sakti.yaml` marker). Never
 * throws.
 */
export function resolveActiveChangeName(projectCwd: string): string | null {
  const changesDir = join(projectCwd, SAKTI_CHANGES_DIR);
  if (!existsSync(changesDir)) return null;

  let best: { name: string; mtime: number } | null = null;
  for (const entry of readdirSync(changesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!isSafeChangeName(entry.name)) continue;
    const marker = join(changesDir, entry.name, ".sakti.yaml");
    if (!existsSync(marker)) continue;
    const mtime = statSync(marker).mtimeMs;
    if (best === null || mtime > best.mtime) {
      best = { name: entry.name, mtime };
    }
  }
  return best?.name ?? null;
}
