import { readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SAKTI_CHANGES_DIR } from "@sakti-code/sakti";

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
    const marker = join(changesDir, entry.name, ".sakti.yaml");
    if (!existsSync(marker)) continue;
    const mtime = statSync(marker).mtimeMs;
    if (best === null || mtime > best.mtime) {
      best = { name: entry.name, mtime };
    }
  }
  return best?.name ?? null;
}
