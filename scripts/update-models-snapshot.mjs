import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const sourcePath = process.env.MODELS_DEV_API_JSON;
const sourceUrl = process.env.MODELS_DEV_URL || "https://models.dev/api.json";
const outputPath =
  process.env.MODELS_SNAPSHOT_OUTPUT_PATH ||
  join(process.cwd(), "src", "provider", "models", "snapshot.json");

async function loadModelsPayload() {
  if (sourcePath) {
    return readFile(sourcePath, "utf-8");
  }

  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`models.dev request failed: ${response.status}`);
  }

  return response.text();
}

const raw = await loadModelsPayload();
const parsed = JSON.parse(raw);

await writeFile(outputPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
console.log(`Updated models snapshot: ${outputPath}`);
