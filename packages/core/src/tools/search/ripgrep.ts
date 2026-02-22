/**
 * Ripgrep binary manager
 *
 * Manages ripgrep (rg) binary installation and path resolution
 * Uses system ripgrep if available, otherwise downloads to XDG data directory
 */

import { createLogger } from "@sakti-code/shared/logger";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const logger = createLogger("sakti-code");

const RIPGREP_VERSION = "14.1.1";

export interface PlatformConfig {
  platform: string;
  extension: "tar.gz" | "zip";
}

export const PLATFORM_CONFIG: Record<string, PlatformConfig> = {
  "x64-linux": { platform: "x86_64-unknown-linux-musl", extension: "tar.gz" },
  "arm64-linux": { platform: "aarch64-unknown-linux-gnu", extension: "tar.gz" },
  "x64-darwin": { platform: "x86_64-apple-darwin", extension: "tar.gz" },
  "arm64-darwin": { platform: "aarch64-apple-darwin", extension: "tar.gz" },
  "x64-win32": { platform: "x86_64-pc-windows-msvc", extension: "zip" },
};

let cachedPath: string | null = null;

/**
 * Get the path to the ripgrep binary
 * Uses system ripgrep if available, otherwise uses bundled binary
 */
export async function getRipgrepPath(): Promise<string> {
  if (cachedPath) {
    return cachedPath;
  }

  // Try to find system ripgrep
  const systemPath = await findSystemRipgrep();
  if (systemPath) {
    cachedPath = systemPath;
    logger.debug("Using system ripgrep", { path: systemPath });
    return systemPath;
  }

  // Fallback to bundled binary
  const bundledPath = await getBundledRipgrep();
  cachedPath = bundledPath;
  logger.debug("Using bundled ripgrep", { path: bundledPath });
  return bundledPath;
}

/**
 * Find system ripgrep binary
 */
async function findSystemRipgrep(): Promise<string | null> {
  try {
    // Try 'which rg' on Unix-like systems
    if (process.platform !== "win32") {
      const result = execSync("which rg", { encoding: "utf-8" }).trim();
      if (result && existsSync(result)) {
        return result;
      }
    }

    // Try 'where rg' on Windows
    if (process.platform === "win32") {
      const result = execSync("where rg", { encoding: "utf-8" }).trim().split("\n")[0];
      if (result && existsSync(result)) {
        return result;
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Get path to bundled ripgrep binary
 * Downloads if not present
 */
async function getBundledRipgrep(): Promise<string> {
  const platformKey = `${process.arch}-${process.platform}`;
  const config = PLATFORM_CONFIG[platformKey];

  if (!config) {
    throw new Error(`Unsupported platform: ${platformKey}`);
  }

  const binDir = path.join(getXDGDataHome(), "sakti-code", "bin");
  const ext = process.platform === "win32" ? ".exe" : "";
  const binaryPath = path.join(binDir, `rg${ext}`);

  // Check if binary already exists
  if (existsSync(binaryPath)) {
    return binaryPath;
  }

  // Download ripgrep
  logger.info("Downloading ripgrep", { version: RIPGREP_VERSION, platform: platformKey });
  await downloadRipgrep(binDir, binaryPath, config);

  return binaryPath;
}

/**
 * Download and extract ripgrep binary
 */
async function downloadRipgrep(
  binDir: string,
  binaryPath: string,
  config: PlatformConfig
): Promise<void> {
  // Create bin directory
  await fs.mkdir(binDir, { recursive: true });

  const filename = `ripgrep-${RIPGREP_VERSION}-${config.platform}.${config.extension}`;
  const url = `https://github.com/BurntSushi/ripgrep/releases/download/${RIPGREP_VERSION}/${filename}`;
  const archivePath = path.join(binDir, filename);

  // Download archive
  logger.debug("Downloading ripgrep archive", { url });
  await downloadFile(url, archivePath);

  // Extract archive
  logger.debug("Extracting ripgrep", { archivePath, binaryPath });
  await extractArchive(archivePath, binaryPath, config);

  // Clean up archive
  await fs.unlink(archivePath);

  // Make executable on Unix
  if (process.platform !== "win32") {
    await fs.chmod(binaryPath, 0o755);
  }

  logger.info("ripgrep downloaded successfully", { binaryPath });
}

/**
 * Download file from URL
 */
async function downloadFile(url: string, destPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download: ${url} (status: ${response.status})`);
  }

  const buffer = await response.arrayBuffer();
  await fs.writeFile(destPath, Buffer.from(buffer));
}

/**
 * Extract archive and copy binary
 */
async function extractArchive(
  archivePath: string,
  binaryPath: string,
  config: PlatformConfig
): Promise<void> {
  if (config.extension === "tar.gz") {
    await extractTarGz(archivePath, binaryPath);
  } else if (config.extension === "zip") {
    await extractZip(archivePath, binaryPath);
  } else {
    throw new Error(`Unsupported archive type: ${config.extension}`);
  }
}

/**
 * Extract tar.gz archive
 */
async function extractTarGz(archivePath: string, binaryPath: string): Promise<void> {
  const binDir = path.dirname(binaryPath);

  try {
    execSync(`tar -xzf "${archivePath}" --strip-components=1 --wildcards "*/rg" -C "${binDir}"`, {
      stdio: "pipe",
    });
  } catch (error) {
    throw new Error(`Failed to extract tar.gz: ${error}`);
  }
}

/**
 * Extract zip archive
 */
async function extractZip(archivePath: string, binaryPath: string): Promise<void> {
  // For Windows, we need to extract from zip
  // This is a simplified implementation - in production, use a proper zip library
  try {
    const unzipCommand =
      process.platform === "win32"
        ? `powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${path.dirname(binaryPath)}' -Force"`
        : `unzip -j "${archivePath}" "*/rg.exe" -d "${path.dirname(binaryPath)}"`;

    execSync(unzipCommand, { stdio: "pipe" });

    // The extracted file might be in a subdirectory, find and move it
    const extractedPath = path.join(path.dirname(binaryPath), "rg.exe");
    if (existsSync(extractedPath) && extractedPath !== binaryPath) {
      await fs.rename(extractedPath, binaryPath);
    }
  } catch (error) {
    throw new Error(`Failed to extract zip: ${error}`);
  }
}

/**
 * Get XDG data home directory
 */
function getXDGDataHome(): string {
  const xdgDataHome = process.env.XDG_DATA_HOME;
  if (xdgDataHome) {
    return xdgDataHome;
  }

  // Fallback to ~/.local/share
  return path.join(os.homedir(), ".local", "share");
}

/**
 * Clear cached path (useful for testing)
 */
export function clearCache(): void {
  cachedPath = null;
}
