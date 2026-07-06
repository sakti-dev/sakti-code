import * as path from "node:path";
import * as os from "node:os";

export const GLOBAL_DATA_DIR_NAME = "sakti";

export interface GlobalDataDirOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  homedir?: string;
}

function joinGlobalDataPath(platform: NodeJS.Platform, ...segments: string[]): string {
  return platform === "win32" ? path.win32.join(...segments) : path.posix.join(...segments);
}

/**
 * Gets the global data directory path following XDG Base Directory Specification.
 * Used for user data like the store registry.
 *
 * - All platforms: $XDG_DATA_HOME/sakti/ if XDG_DATA_HOME is set
 * - Unix/macOS fallback: ~/.local/share/sakti/
 * - Windows fallback: %LOCALAPPDATA%/sakti/
 */
export function getGlobalDataDir(options: GlobalDataDirOptions = {}): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? os.platform();

  // XDG_DATA_HOME takes precedence on all platforms when explicitly set
  const xdgDataHome = env.XDG_DATA_HOME;
  if (xdgDataHome) {
    return joinGlobalDataPath(platform, xdgDataHome, GLOBAL_DATA_DIR_NAME);
  }

  const homedir = options.homedir ?? os.homedir();

  if (platform === "win32") {
    // Windows: use %LOCALAPPDATA%
    const localAppData = env.LOCALAPPDATA;
    if (localAppData) {
      return joinGlobalDataPath(platform, localAppData, GLOBAL_DATA_DIR_NAME);
    }
    // Fallback for Windows if LOCALAPPDATA is not set
    return joinGlobalDataPath(platform, homedir, "AppData", "Local", GLOBAL_DATA_DIR_NAME);
  }

  // Unix/macOS fallback: ~/.local/share
  return joinGlobalDataPath(platform, homedir, ".local", "share", GLOBAL_DATA_DIR_NAME);
}
