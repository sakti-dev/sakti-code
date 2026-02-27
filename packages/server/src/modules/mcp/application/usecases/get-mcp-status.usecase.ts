export interface GetMcpStatusInput {
  directory?: string;
  fallbackDirectory?: string;
}

export interface GetMcpStatusOutput {
  directory: string;
  servers: unknown[];
  summary: {
    total: number;
    connected: number;
    degraded: number;
    offline: number;
  };
}

export function resolveMcpDirectory(
  input: GetMcpStatusInput
): { ok: true; directory: string } | { ok: false; reason: string } {
  const raw = input.directory?.trim() || input.fallbackDirectory?.trim() || process.cwd();
  if (!raw) return { ok: false, reason: "Directory parameter required" };
  if (!raw.trim()) return { ok: false, reason: "Invalid directory parameter" };
  if (/\u0000/.test(raw)) return { ok: false, reason: "Invalid directory parameter" };
  return { ok: true, directory: raw };
}

export function getMcpStatusUsecase(directory: string): GetMcpStatusOutput {
  return {
    directory,
    servers: [],
    summary: {
      total: 0,
      connected: 0,
      degraded: 0,
      offline: 0,
    },
  };
}
