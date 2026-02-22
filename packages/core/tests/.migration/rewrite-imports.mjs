#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const corePkg = path.resolve(__dirname, "../..");
const srcDir = path.resolve(corePkg, "src");

const DOMAINS = [
  "spec",
  "config",
  "chat",
  "agent",
  "session",
  "workspace",
  "tools",
  "instance",
  "skill",
  "lsp",
  "plugin",
  "security",
  "memory",
  "prompts",
];

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    domain: null,
    dryRun: false,
    apply: false,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--domain" && args[i + 1]) {
      options.domain = args[i + 1];
      i++;
    } else if (args[i] === "--dry-run") {
      options.dryRun = true;
    } else if (args[i] === "--apply") {
      options.apply = true;
    }
  }

  return options;
}

function getTestFilesForDomain(domain) {
  const domainTestDir = path.join(srcDir, domain, "__tests__");
  if (!fs.existsSync(domainTestDir)) {
    return [];
  }

  const files = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(".test.ts")) {
        files.push(fullPath);
      }
    }
  }
  walk(domainTestDir);
  return files;
}

function rewriteImports(filePath, domain) {
  let content = fs.readFileSync(filePath, "utf-8");
  const originalContent = content;

  content = content.replace(
    /from\s+["']\.\.\/src\/([^"']+)["']/g,
    (match, importPath) => {
      return `from "@/${importPath}"`;
    }
  );

  content = content.replace(
    /from\s+["']\.\.\/\.\.\/src\/([^"']+)["']/g,
    (match, importPath) => {
      return `from "@/${importPath}"`;
    }
  );

  content = content.replace(
    /from\s+["']\.\.\/\.\.\/\.\.\/src\/([^"']+)["']/g,
    (match, importPath) => {
      return `from "@/${importPath}"`;
    }
  );

  content = content.replace(
    /from\s+["']\.\.\/\.\.\/\.\.\/\.\.\/src\/([^"']+)["']/g,
    (match, importPath) => {
      return `from "@/${importPath}"`;
    }
  );

  content = content.replace(
    /import\(["']\.\.\/src\/([^"']+)["']\)/g,
    (match, importPath) => {
      return `import("@/${importPath}")`;
    }
  );

  content = content.replace(
    /import\(["']\.\.\/\.\.\/src\/([^"']+)["']\)/g,
    (match, importPath) => {
      return `import("@/${importPath}")`;
    }
  );

  content = content.replace(
    /import\(["']\.\.\/\.\.\/\.\.\/src\/([^"']+)["']\)/g,
    (match, importPath) => {
      return `import("@/${importPath}")`;
    }
  );

  content = content.replace(
    /import\(["']\.\.\/\.\.\/\.\.\/\.\.\/src\/([^"']+)["']\)/g,
    (match, importPath) => {
      return `import("@/${importPath}")`;
    }
  );

  content = content.replace(
    /vi\.mock\(["']\.\.\/src\/([^"']+)["']/g,
    (match, importPath) => {
      return `vi.mock("@/${importPath}"`;
    }
  );

  content = content.replace(
    /vi\.mock\(["']\.\.\/\.\.\/src\/([^"']+)["']/g,
    (match, importPath) => {
      return `vi.mock("@/${importPath}"`;
    }
  );

  content = content.replace(
    /vi\.mock\(["']\.\.\/\.\.\/\.\.\/src\/([^"']+)["']/g,
    (match, importPath) => {
      return `vi.mock("@/${importPath}"`;
    }
  );

  content = content.replace(
    /vi\.mock\(["']\.\.\/\.\.\/\.\.\/\.\.\/src\/([^"']+)["']/g,
    (match, importPath) => {
      return `vi.mock("@/${importPath}"`;
    }
  );

  return content === originalContent ? null : content;
}

function main() {
  const options = parseArgs();

  if (!options.domain) {
    console.error("Usage: node rewrite-imports.mjs --domain <domain> [--dry-run|--apply]");
    console.error(`Available domains: ${DOMAINS.join(", ")}`);
    process.exit(1);
  }

  if (!DOMAINS.includes(options.domain)) {
    console.error(`Invalid domain: ${options.domain}`);
    console.error(`Available domains: ${DOMAINS.join(", ")}`);
    process.exit(1);
  }

  const files = getTestFilesForDomain(options.domain);

  if (files.length === 0) {
    console.log(`No test files found for domain: ${options.domain}`);
    return;
  }

  console.log(`Domain: ${options.domain}`);
  console.log(`Mode: ${options.dryRun ? "DRY RUN" : options.apply ? "APPLY" : "LIST"}`);
  console.log(`Found ${files.length} test file(s)\n`);

  let modifiedCount = 0;

  for (const file of files) {
    const newContent = rewriteImports(file, options.domain);

    if (newContent) {
      console.log(`${file}`);
      console.log(`  [MODIFIED]`);
      modifiedCount++;

      if (options.apply) {
        fs.writeFileSync(file, newContent, "utf-8");
      }
    }
  }

  if (options.apply) {
    console.log(`\n${modifiedCount} file(s) updated.`);
  } else {
    console.log(`\n${modifiedCount} file(s) would be modified.`);
  }
}

main();
