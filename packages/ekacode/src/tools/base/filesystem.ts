/**
 * Filesystem utilities for tool operations
 */

import path from "node:path";

export function containsPath(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return !relative.startsWith("..");
}

export async function normalizePath(p: string): Promise<string> {
  if (process.platform !== "win32") return p;
  try {
    const fs = await import("node:fs");
    return fs.realpathSync.native(p);
  } catch {
    return p;
  }
}

export async function assertExternalDirectory(
  target: string,
  workspaceRoot: string,
  ask?: (permission: "external_directory", patterns: string[]) => Promise<boolean>
): Promise<void> {
  if (containsPath(workspaceRoot, target)) return;

  // Ask for external directory permission
  if (ask) {
    const approved = await ask("external_directory", [path.join(path.dirname(target), "*")]);

    if (!approved) {
      throw new Error(`Permission denied: External directory access to ${target}`);
    }
  }
}

export async function detectBinaryFile(_filepath: string, content: Buffer): Promise<boolean> {
  // Check for common binary signatures
  const binarySignatures: number[][] = [
    [0x50, 0x4b], // ZIP, JAR, ODF
    [0x50, 0x4b, 0x03, 0x04], // ZIP
    [0x50, 0x4b, 0x05, 0x06], // ZIP empty
    [0x50, 0x4b, 0x07, 0x08], // ZIP spanned
    [0x1f, 0x8b], // GZIP
    [0x42, 0x5a, 0x68], // BZIP2
    [0x25, 0x50, 0x44, 0x46], // PDF
    [0x49, 0x49, 0x2a, 0x00], // TIFF little-endian
    [0x4d, 0x4d, 0x00, 0x2a], // TIFF big-endian
    [0x52, 0x49, 0x46, 0x46], // RIFF (WAV, AVI, etc.)
    [0x47, 0x49, 0x46, 0x38], // GIF
    [0x89, 0x50, 0x4e, 0x47], // PNG
    [0xff, 0xd8, 0xff], // JPEG
    [0x00, 0x00, 0x01, 0x00], // ICO
    [0x00, 0x00, 0x02, 0x00], // CUR
    [0x4d, 0x5a], // EXE
    [0x7f, 0x45, 0x4c, 0x46], // ELF
    [0xfe, 0xed, 0xfa, 0xcf], // Mach-O binary
    [0xce, 0xfa, 0xed, 0xfe], // Mach-O binary (arm)
  ];

  const header = content.slice(0, 8);
  for (const sig of binarySignatures) {
    if (sig.length > header.length) continue;
    let match = true;
    for (let i = 0; i < sig.length; i++) {
      if (header[i] !== sig[i]) {
        match = false;
        break;
      }
    }
    if (match) return true;
  }

  // Check for null bytes (common in binary files)
  if (content.includes(0)) return true;

  return false;
}
