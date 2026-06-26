export type { TruncationOptions, TruncationResult } from "./lib/truncate.ts";
export {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  GREP_MAX_LINE_LENGTH,
  truncateHead,
  truncateLine,
  truncateTail,
} from "./lib/truncate.ts";
export { INTAKE_SYSTEM_PROMPT } from "./prompts/intake-system-prompt.ts";
export { EventStream } from "./utils/event-stream.ts";
