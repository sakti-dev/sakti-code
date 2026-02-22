import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

let workDir = "";

afterEach(async () => {
  if (workDir) {
    await rm(workDir, { recursive: true, force: true });
    workDir = "";
  }
});

describe("update-models-snapshot script", () => {
  it("writes snapshot.json from MODELS_DEV_API_JSON input", async () => {
    workDir = await mkdtemp(join(tmpdir(), "sakti-code-model-snapshot-"));

    const sourcePath = join(workDir, "models-api.json");
    const outputPath = join(workDir, "snapshot.json");

    await writeFile(
      sourcePath,
      JSON.stringify(
        {
          zai: {
            name: "Z.AI",
            models: {
              "glm-5": { id: "glm-5", name: "GLM-5" },
            },
          },
        },
        null,
        2
      ),
      "utf-8"
    );

    const run = spawnSync(process.execPath, ["../../scripts/update-models-snapshot.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        MODELS_DEV_API_JSON: sourcePath,
        MODELS_SNAPSHOT_OUTPUT_PATH: outputPath,
      },
      encoding: "utf-8",
    });
    expect(run.status).toBe(0);

    const written = JSON.parse(await readFile(outputPath, "utf-8")) as {
      zai?: { models?: Record<string, { id: string; name: string }> };
    };
    expect(written.zai?.models?.["glm-5"]?.name).toBe("GLM-5");
  });
});
