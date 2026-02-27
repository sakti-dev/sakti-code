export interface LspServerStatus {
  id: string;
  name: string;
  root: string;
  status: string;
}

export interface GetLspStatusInput {
  directory?: string;
  fallbackDirectory?: string;
}

export interface GetLspStatusOutput {
  directory: string | undefined;
  servers: LspServerStatus[];
}

export async function getLspStatusUsecase(input: GetLspStatusInput): Promise<GetLspStatusOutput> {
  const directory = input.directory || input.fallbackDirectory;
  let servers: LspServerStatus[] = [];

  try {
    const { LSP } = await import("@sakti-code/core");
    const status = LSP.getStatus();
    servers = status.map((server: LspServerStatus) => ({
      id: server.id,
      name: server.name,
      root: server.root,
      status: server.status,
    }));
  } catch {
    servers = [];
  }

  return { directory, servers };
}
