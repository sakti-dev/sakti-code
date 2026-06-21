import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface WindowFrame {
  height: number;
  width: number;
  x: number;
  y: number;
}

const CONFIG_DIR = join(homedir(), ".sakti");
const STATE_FILE = join(CONFIG_DIR, "window-state.json");

export const DEFAULT_FRAME: WindowFrame = {
  x: 100,
  y: 100,
  width: 1200,
  height: 800,
};

const MIN_WIDTH = 600;
const MIN_HEIGHT = 400;
const SAVE_DEBOUNCE_MS = 500;

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function loadWindowState(): WindowFrame {
  try {
    if (!existsSync(STATE_FILE)) {
      return { ...DEFAULT_FRAME };
    }
    const raw = readFileSync(STATE_FILE, "utf-8");
    return validateFrame(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_FRAME };
  }
}

export function saveWindowState(frame: WindowFrame): void {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(frame, null, "\t"), "utf-8");
  } catch (error) {
    console.warn("Failed to save window state:", error);
  }
}

export function debouncedSaveWindowState(frame: WindowFrame): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    saveWindowState(frame);
    saveTimer = null;
  }, SAVE_DEBOUNCE_MS);
}

export function flushWindowState(frame: WindowFrame): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  saveWindowState(frame);
}

function validateFrame(parsed: unknown): WindowFrame {
  if (typeof parsed !== "object" || parsed === null) {
    return { ...DEFAULT_FRAME };
  }

  const obj = parsed as Record<string, unknown>;

  const width =
    typeof obj.width === "number" && Number.isFinite(obj.width)
      ? Math.max(obj.width, MIN_WIDTH)
      : DEFAULT_FRAME.width;

  const height =
    typeof obj.height === "number" && Number.isFinite(obj.height)
      ? Math.max(obj.height, MIN_HEIGHT)
      : DEFAULT_FRAME.height;

  const x =
    typeof obj.x === "number" && Number.isFinite(obj.x)
      ? obj.x
      : DEFAULT_FRAME.x;

  const y =
    typeof obj.y === "number" && Number.isFinite(obj.y)
      ? obj.y
      : DEFAULT_FRAME.y;

  return { x, y, width, height };
}
