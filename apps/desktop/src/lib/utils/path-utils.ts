export function middleEllipsisPath(path: string, maxLength = 64): string {
  if (path.length <= maxLength) {
    return path;
  }

  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 2) {
    const keep = Math.max(8, maxLength - 3);
    return `${path.slice(0, keep)}...`;
  }

  const first = parts[0] ?? "";
  const tail = parts.slice(-3).join("/");
  const candidate = `${first}/.../${tail}`;
  if (candidate.length <= maxLength) {
    return candidate;
  }
  return `.../${tail}`;
}
