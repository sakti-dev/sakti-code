export function formatRetryCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  if (safe < 60) return `${safe}s`;
  const minutes = Math.floor(safe / 60);
  const remainingSeconds = safe % 60;
  if (remainingSeconds === 0) return `${minutes}m`;
  return `${minutes}m ${remainingSeconds}s`;
}

export function readRetrySecondsLeft(
  next: number | undefined,
  now = Date.now()
): number | undefined {
  if (typeof next !== "number" || !Number.isFinite(next) || next <= 0) return undefined;
  return Math.max(0, Math.ceil((next - now) / 1000));
}
