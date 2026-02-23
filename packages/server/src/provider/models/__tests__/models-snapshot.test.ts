import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("models snapshot", () => {
  it("includes GLM-5 fallback entries for zai", async () => {
    const raw = await readFile(
      join(process.cwd(), "src", "provider", "models", "snapshot.json"),
      "utf-8"
    );
    const snapshot = JSON.parse(raw) as {
      zai?: {
        models?: Record<string, { id: string; name: string }>;
      };
    };

    expect(snapshot.zai?.models?.["glm-5"]).toBeDefined();
    expect(snapshot.zai?.models?.["glm-5"]?.name).toMatch(/GLM-5/i);
  });
});
