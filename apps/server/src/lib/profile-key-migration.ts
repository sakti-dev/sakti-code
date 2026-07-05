import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

export function migrateProfileKeys(filePath: string): void {
  if (!existsSync(filePath)) return;

  const content = readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(content) as {
    profiles: Record<string, { models: Record<string, unknown> }>;
  };

  let changed = false;
  for (const profile of Object.values(parsed.profiles)) {
    const models = profile.models;
    if ("plan" in models && !("spec" in models)) {
      models.spec = models.plan;
      delete models.plan;
      changed = true;
    }
    if ("intake" in models && !("plan" in models)) {
      models.plan = models.intake;
      delete models.intake;
      changed = true;
    }
  }

  if (changed) {
    const tmp = `${filePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(parsed, null, 2), "utf-8");
    renameSync(tmp, filePath);
  }
}
