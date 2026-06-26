import path from "node:path/posix";

function stripPrefix(
  relativePath: string,
  prefixes: string[]
): string | undefined {
  const normalized = relativePath.replaceAll("\\", "/");
  for (const prefix of prefixes) {
    if (normalized.startsWith(prefix)) {
      return normalized.slice(prefix.length);
    }
  }
  return;
}

/**
 * Derives a config entry name (e.g. slash-command trigger or agent name) from a
 * file path relative to the scanned directory, by stripping a known prefix
 * (`command/`, `agents/`, ...) and the extension.
 *
 * Ported from opencode `packages/opencode/src/config/entry-name.ts`. Callers
 * must pass a path relative to the scanned directory so the prefix match is
 * anchored (matching anywhere in an absolute path used to mis-key entries whose
 * parent segments coincidentally contained a prefix name).
 */
export function configEntryNameFromPath(
  relativePath: string,
  prefixes: string[]
): string {
  const candidate =
    stripPrefix(relativePath, prefixes) ?? path.basename(relativePath);
  const ext = path.extname(candidate);
  return ext.length ? candidate.slice(0, -ext.length) : candidate;
}
