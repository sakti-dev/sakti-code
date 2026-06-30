import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve as nodeResolvePath } from "node:path";

const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

interface PathInputOptions {
  expandTilde?: boolean;
  homeDir?: string;
  normalizeUnicodeSpaces?: boolean;
  stripAtPrefix?: boolean;
  trim?: boolean;
}

function normalizePath(input: string, options: PathInputOptions = {}): string {
  let normalized = options.trim ? input.trim() : input;
  if (options.normalizeUnicodeSpaces) {
    normalized = normalized.replace(UNICODE_SPACES, " ");
  }
  if (options.stripAtPrefix && normalized.startsWith("@")) {
    normalized = normalized.slice(1);
  }

  if (options.expandTilde ?? true) {
    const home = options.homeDir ?? homedir();
    if (normalized === "~") {
      return home;
    }
    if (
      normalized.startsWith("~/") ||
      (process.platform === "win32" && normalized.startsWith("~\\"))
    ) {
      return join(home, normalized.slice(2));
    }
  }

  if (normalized.startsWith("file://")) {
    return decodeURIComponent(new URL(normalized).pathname);
  }

  return normalized;
}

function resolvePath(
  input: string,
  baseDir: string = process.cwd(),
  options: PathInputOptions = {}
): string {
  const normalized = normalizePath(input, options);
  const normalizedBaseDir = normalizePath(baseDir);
  return isAbsolute(normalized)
    ? nodeResolvePath(normalized)
    : nodeResolvePath(normalizedBaseDir, normalized);
}

const NARROW_NO_BREAK_SPACE = "\u202F";

function tryMacOSScreenshotPath(filePath: string): string {
  return filePath.replace(/ (AM|PM)\./gi, `${NARROW_NO_BREAK_SPACE}$1.`);
}

function tryNFDVariant(filePath: string): string {
  return filePath.normalize("NFD");
}

function tryCurlyQuoteVariant(filePath: string): string {
  return filePath.replace(/'/g, "\u2019");
}

export async function pathExists(filePath: string): Promise<boolean> {
  return existsSync(filePath);
}

export function expandPath(filePath: string): string {
  return normalizePath(filePath, {
    normalizeUnicodeSpaces: true,
    stripAtPrefix: true,
  });
}

export function resolveToCwd(filePath: string, cwd: string): string {
  return resolvePath(filePath, cwd, {
    normalizeUnicodeSpaces: true,
    stripAtPrefix: true,
  });
}

export async function resolveReadPathAsync(
  filePath: string,
  cwd: string
): Promise<string> {
  const resolved = resolveToCwd(filePath, cwd);

  if (await pathExists(resolved)) {
    return resolved;
  }

  const amPmVariant = tryMacOSScreenshotPath(resolved);
  if (amPmVariant !== resolved && (await pathExists(amPmVariant))) {
    return amPmVariant;
  }

  const nfdVariant = tryNFDVariant(resolved);
  if (nfdVariant !== resolved && (await pathExists(nfdVariant))) {
    return nfdVariant;
  }

  const curlyVariant = tryCurlyQuoteVariant(resolved);
  if (curlyVariant !== resolved && (await pathExists(curlyVariant))) {
    return curlyVariant;
  }

  const nfdCurlyVariant = tryCurlyQuoteVariant(nfdVariant);
  if (nfdCurlyVariant !== resolved && (await pathExists(nfdCurlyVariant))) {
    return nfdCurlyVariant;
  }

  return resolved;
}
