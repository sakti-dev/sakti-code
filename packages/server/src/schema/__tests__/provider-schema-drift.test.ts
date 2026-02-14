import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { providerSchemaArtifact } from "../../routes/provider.openapi";

describe("provider schema drift", () => {
  it("matches committed provider schema artifact", async () => {
    const raw = await readFile(new URL("../provider.schemas.json", import.meta.url), "utf-8");
    const committed = JSON.parse(raw) as unknown;

    expect(committed).toEqual(providerSchemaArtifact);
  });
});
