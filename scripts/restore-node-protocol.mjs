import { readdirSync, statSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { join } from "node:path";

// tsup's builtin handling rewrites `node:sqlite` → bare `sqlite` in its output
// (bare `fs`/`os`/`path` still resolve, but `sqlite` is only valid as
// `node:sqlite`). Restore the `node:` prefix for every bare builtin specifier.
const dist = process.argv[2];
if (!dist) {
  console.error("usage: restore-node-protocol.mjs <distDir>");
  process.exit(1);
}
const NODE_PREFIX = /^node:/;
const mods = new Set(builtinModules.map((m) => m.replace(NODE_PREFIX, "")));

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      yield* walk(p);
    } else if (p.endsWith(".js") || p.endsWith(".mjs") || p.endsWith(".cjs")) {
      yield p;
    }
  }
}

const re =
  /(\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([a-z][\w-]*(?:\/[\w-]+)*)["']/g;

let touched = 0;
for (const file of walk(dist)) {
  const src = await readFile(file, "utf8");
  const out = src.replace(re, (match, prefix, spec) => {
    const top = spec.split("/")[0];
    if (!mods.has(top)) {
      return match;
    }
    return `${prefix}"node:${spec}"`;
  });
  if (out !== src) {
    await writeFile(file, out);
    touched++;
  }
}
if (touched) {
  console.log(`restore-node-protocol: fixed ${touched} file(s) in ${dist}`);
}
