#!/usr/bin/env node

import { execSync } from "node:child_process";

const MIGRATIONS_ROOT = "packages/server/drizzle/";
const JOURNAL_PATH = "packages/server/drizzle/meta/_journal.json";
const SQL_FILE_PATTERN = /^packages\/server\/drizzle\/\d+_.+\.sql$/;
const SNAPSHOT_FILE_PATTERN = /^packages\/server\/drizzle\/meta\/\d+_snapshot\.json$/;

function parseNameStatusLine(line) {
  const parts = line.split("\t");
  const status = parts[0];
  if (!status) return null;

  if (status.startsWith("R") || status.startsWith("C")) {
    return {
      status,
      oldPath: parts[1],
      newPath: parts[2],
    };
  }

  return {
    status,
    path: parts[1],
  };
}

function isMigrationPath(filePath) {
  return typeof filePath === "string" && filePath.startsWith(MIGRATIONS_ROOT);
}

function allowChange(status, filePath) {
  if (!isMigrationPath(filePath)) return true;

  if (status === "A" && (SQL_FILE_PATTERN.test(filePath) || SNAPSHOT_FILE_PATTERN.test(filePath))) {
    return true;
  }

  if (status === "M" && filePath === JOURNAL_PATH) {
    return true;
  }

  return false;
}

export function evaluateMigrationDiff(lines) {
  const errors = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const parsed = parseNameStatusLine(line);
    if (!parsed) continue;

    if ("oldPath" in parsed) {
      if (isMigrationPath(parsed.oldPath) || isMigrationPath(parsed.newPath)) {
        errors.push(
          `Disallowed migration change: ${parsed.status} ${parsed.oldPath ?? ""} -> ${parsed.newPath ?? ""}`
        );
      }
      continue;
    }

    if (!allowChange(parsed.status, parsed.path)) {
      errors.push(`Disallowed migration change: ${parsed.status} ${parsed.path}`);
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

function getDefaultDiffRange() {
  try {
    const upstream = execSync("git rev-parse --abbrev-ref --symbolic-full-name @{upstream}", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return `${upstream}...HEAD`;
  } catch {
    return "HEAD~1..HEAD";
  }
}

function getNameStatusLines(fromRef, toRef) {
  const range = fromRef && toRef ? `${fromRef}..${toRef}` : getDefaultDiffRange();
  const output = execSync(`git diff --name-status ${range}`, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return output.split("\n").filter(Boolean);
}

function parseArgs(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i++) {
    const current = argv[i];
    if (current === "--from") args.set("from", argv[i + 1]);
    if (current === "--to") args.set("to", argv[i + 1]);
  }
  return {
    from: args.get("from"),
    to: args.get("to"),
  };
}

function main() {
  const { from, to } = parseArgs(process.argv.slice(2));
  const lines = getNameStatusLines(from, to);
  const result = evaluateMigrationDiff(lines);

  if (!result.ok) {
    console.error("Migration policy check failed:");
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("Migration policy check passed.");
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
