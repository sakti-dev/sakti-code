import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const cssPath = require.resolve("velomark/styles.css");
if (!cssPath.endsWith("styles.css")) {
  throw new Error(`Unexpected CSS export path: ${cssPath}`);
}

const builtHtmlPath = path.resolve("dist", "index.html");
if (!existsSync(builtHtmlPath)) {
  throw new Error(`Expected built consumer HTML at ${builtHtmlPath}`);
}

const builtHtml = readFileSync(builtHtmlPath, "utf8");

if (!builtHtml.includes('<script type="module" crossorigin')) {
  throw new Error("Expected Vite consumer build to emit a module script tag");
}

const assetsDir = path.resolve("dist", "assets");
if (!existsSync(assetsDir)) {
  throw new Error(`Expected built consumer assets directory at ${assetsDir}`);
}
