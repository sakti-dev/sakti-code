import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  createServer,
  type SaktiServer,
} from "@sakti-code/server/create-server";
import { BrowserWindow } from "electrobun/bun";
import {
  debouncedSaveWindowState,
  flushWindowState,
  loadWindowState,
  type WindowFrame,
} from "./window-state";

const isDev = process.env.SAKTI_DEV === "1";
const APP_TITLE = "sakti-code";

interface ResizeEventData {
  height: number;
  id: number;
  width: number;
  x: number;
  y: number;
}

interface MoveEventData {
  id: number;
  x: number;
  y: number;
}

interface ElectrobunEvent<T> {
  data: T;
}

async function waitForReady(url: string): Promise<void> {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) {
        return;
      }
    } catch {
      // Server not ready yet
    }
    await Bun.sleep(100);
  }
  throw new Error(`Server not ready at ${url}`);
}

let currentFrame: WindowFrame;
let server: SaktiServer | null = null;
let isShuttingDown = false;

function shutdown(reason: string): void {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  console.log(`Shutting down (${reason})...`);
  flushWindowState(currentFrame);
  server?.stop();
  process.exit(0);
}

function wireWindowLifecycle(mainWindow: BrowserWindow): void {
  mainWindow.on("resize", (event: unknown) => {
    const { data } = event as ElectrobunEvent<ResizeEventData>;
    currentFrame = {
      x: data.x,
      y: data.y,
      width: data.width,
      height: data.height,
    };
    debouncedSaveWindowState(currentFrame);
  });

  mainWindow.on("move", (event: unknown) => {
    const { data } = event as ElectrobunEvent<MoveEventData>;
    currentFrame = { ...currentFrame, x: data.x, y: data.y };
    debouncedSaveWindowState(currentFrame);
  });

  mainWindow.on("close", () => {
    try {
      const finalFrame = mainWindow.getFrame();
      flushWindowState(finalFrame);
    } catch {
      flushWindowState(currentFrame);
    }
    shutdown("window closed");
  });
}

async function bootstrap(): Promise<void> {
  currentFrame = loadWindowState();
  console.log(
    `Restoring window: ${currentFrame.width}x${currentFrame.height} at (${currentFrame.x}, ${currentFrame.y})`
  );

  let url: string;

  if (isDev) {
    url = "http://localhost:5173";
    console.log("Dev mode: loading from Vite dev server");
    console.log("Ensure standalone server is running: bun dev:server");
  } else {
    const staticDir = resolve(import.meta.dir, "../web-dist");
    if (!existsSync(staticDir)) {
      console.warn(`Static dir not found: ${staticDir}`);
    }
    const dbPath = join(homedir(), ".sakti", "sakti-code.db");
    const sakti = await createServer({ port: 0, staticDir, dbPath });
    server = sakti;
    await waitForReady(sakti.url);
    url = sakti.url;
    console.log(`Server started on ${url}`);
  }

  const mainWindow = new BrowserWindow({
    title: APP_TITLE,
    url,
    frame: currentFrame,
  });

  wireWindowLifecycle(mainWindow);

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  console.log(`${APP_TITLE} window opened at ${url}`);
}

bootstrap().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
