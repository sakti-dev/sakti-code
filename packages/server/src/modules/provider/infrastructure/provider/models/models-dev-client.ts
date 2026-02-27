export interface ModelsDevModel {
  id: string;
  name: string;
  modalities?: {
    input?: Array<"text" | "audio" | "image" | "video" | "pdf">;
    output?: Array<"text" | "audio" | "image" | "video" | "pdf">;
  };
  provider?: {
    api?: string;
    npm?: string;
  };
}

export interface ModelsDevProvider {
  name: string;
  api?: string;
  npm?: string;
  env?: string[];
  models: Record<string, ModelsDevModel>;
}

export type ModelsDevPayload = Record<string, ModelsDevProvider>;

export async function fetchModelsDev(
  url = "https://models.dev/api.json"
): Promise<ModelsDevPayload> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`models.dev request failed: ${response.status}`);
  }

  return (await response.json()) as ModelsDevPayload;
}
