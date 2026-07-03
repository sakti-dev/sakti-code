import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";

dayjs.extend(duration);

export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return "<1s";
  }
  const d = dayjs.duration(ms);
  const hours = d.hours();
  const minutes = d.minutes();
  const seconds = d.seconds();

  if (hours > 0) {
    return seconds > 0 ? `${hours}h ${minutes}m ${seconds}s` : `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  return `${seconds}s`;
}
