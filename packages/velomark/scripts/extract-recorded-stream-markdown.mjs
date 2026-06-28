import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { extractMarkdownFromRecordedFixture } from "./extract-recorded-stream-markdown-lib.mjs";

const [, , inputPath, outputPath] = process.argv;

if (!(inputPath && outputPath)) {
  throw new Error(
    "Usage: node scripts/extract-recorded-stream-markdown.mjs <input-json> <output-md>"
  );
}

const resolvedInputPath = path.resolve(process.cwd(), inputPath);
const resolvedOutputPath = path.resolve(process.cwd(), outputPath);
const fixture = JSON.parse(readFileSync(resolvedInputPath, "utf8"));
const markdown = extractMarkdownFromRecordedFixture(fixture);

const output =
  path.extname(resolvedOutputPath) === ".ts"
    ? `const recordedChatReplay = ${JSON.stringify(markdown)};\n\nexport default recordedChatReplay;\n`
    : markdown;

writeFileSync(resolvedOutputPath, output, "utf8");
