import type { VelomarkTheme } from "./types";

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Record<string, unknown>
    ? DeepPartial<T[K]>
    : T[K];
};

export type PartialVelomarkTheme = DeepPartial<VelomarkTheme>;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const mergeRecords = (
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> => {
  const result: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(override)) {
    const currentValue = result[key];

    if (isPlainObject(currentValue) && isPlainObject(value)) {
      result[key] = mergeRecords(currentValue, value);
      continue;
    }

    if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
};

export const mergeTheme = (
  base: VelomarkTheme,
  override: PartialVelomarkTheme
): VelomarkTheme =>
  mergeRecords(
    base as unknown as Record<string, unknown>,
    override as Record<string, unknown>
  ) as unknown as VelomarkTheme;
