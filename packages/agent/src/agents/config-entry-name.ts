import path from "node:path/posix";

function stripPrefix(relativePath: string, prefixes: string[]): string | undefined {
  const normalized = relativePath.replaceAll("\\", "/");
  for (const prefix of prefixes) {
    if (normalized.startsWith(prefix)) {
      return normalized.slice(prefix.length);
    }
  }
  return;
}

export function configEntryNameFromPath(relativePath: string, prefixes: string[]): string {
  const candidate = stripPrefix(relativePath, prefixes) ?? path.basename(relativePath);
  const ext = path.extname(candidate);
  return ext.length ? candidate.slice(0, -ext.length) : candidate;
}
