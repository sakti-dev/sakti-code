import { homedir } from "node:os";
import { resolve } from "node:path";

export interface CommandScan {
  /** Resolved absolute paths the command references outside the project cwd. */
  externalDirectories: string[];
}

/**
 * Scan a shell command for directory/file references that fall outside the
 * project `cwd` — the basis for the bash tool's `external_directory` permission
 * request.
 *
 * Cross-compare note: opencode parses the command with tree-sitter (bash +
 * powershell WASM grammars) for precision. sakti uses a lightweight tokenizer
 * to avoid that heavy dependency; it catches the security-relevant cases
 * (absolute paths, `../` traversals, `~`/`$HOME` references outside cwd) but is
 * less precise than a full AST parse. Upgrading to tree-sitter is a follow-up.
 */
export function scanCommand(command: string, cwd: string): CommandScan {
  const tokens = tokenize(command);
  const external = new Set<string>();
  for (const raw of tokens) {
    const token = expandHome(raw);
    if (!looksLikePath(token)) {
      continue;
    }
    const resolved = resolve(cwd, token);
    if (!isWithin(resolved, cwd)) {
      external.add(resolved);
    }
  }
  return { externalDirectories: [...external] };
}

/** Shell-style tokenizer that strips matching single/double quotes. */
function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const char of command) {
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function expandHome(token: string): string {
  if (token === "~") {
    return homedir();
  }
  if (token.startsWith("~/")) {
    return homedir() + token.slice(1);
  }
  if (token.startsWith("$HOME/")) {
    return homedir() + token.slice(5);
  }
  if (token.startsWith("$HOME")) {
    return homedir() + token.slice(5);
  }
  return token;
}

function looksLikePath(token: string): boolean {
  return token.includes("/") || token === "..";
}

function isWithin(resolved: string, cwd: string): boolean {
  return resolved === cwd || resolved.startsWith(`${cwd}/`);
}
