import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  createServer,
  type SaktiServer,
} from "@sakti-code/server/create-server";
import { BrowserWindow, Screen, Utils } from "electrobun/bun";
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

  // Always create server with hooks (needed for native dialogs)
  const dbPath = join(homedir(), ".sakti", "sakti-code.db");
  const sakti = await createServer({
    port: isDev ? 3001 : 0,
    staticDir: isDev ? null : resolve(import.meta.dir, "../web-dist"),
    dbPath,
    hooks: {
      onOpenFolderDialog: async () => {
        const result = await Utils.openFileDialog({
          canChooseFiles: false,
          canChooseDirectory: true,
          allowsMultipleSelection: false,
        });
        return result[0] ?? null;
      },
    },
    // In dev mode, migrations are in the source tree; in prod, they're co-located
    migrationsFolder: isDev ? process.env.SAKTI_MIGRATIONS_FOLDER : undefined,
  });
  server = sakti;
  await waitForReady(sakti.url);
  console.log(`Server started on ${sakti.url}`);

  // In dev mode, load frontend from Vite; in prod, use the bundled static files
  // CEF on Linux doesn't auto-scale on high-DPI displays (especially on
  // Wayland where GDK only reports integer scales). Compute a sensible CSS
  // zoom from the display resolution when the OS isn't scaling, and pass
  // it to the webview (see inline script in index.html).
  const display = Screen.getPrimaryDisplay();
  let scale = display.scaleFactor;
  if (scale <= 1) {
    const w = display.bounds.width;
    if (w >= 3840) {
      scale = 2.0;
    } else if (w >= 2880) {
      scale = 1.5;
    } else if (w >= 2560) {
      scale = 1.25;
    }
  }
  const scaleParam = scale > 1.01 ? `?dpr=${scale}` : "";
  const url = isDev
    ? `http://localhost:5173${scaleParam}`
    : `${sakti.url}${scaleParam}`;

  if (isDev) {
    await waitForReady(url);
    console.log(`Vite ready at ${url}`);
  }

  const mainWindow = new BrowserWindow({
    title: APP_TITLE,
    url,
    frame: currentFrame,
  });

  wireWindowLifecycle(mainWindow);

  if (isDev) {
    mainWindow.webview.openDevTools();
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  console.log(`${APP_TITLE} window opened at ${url}`);
}

bootstrap().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
