export interface ModelsDevModel {
  id: string;
  name: string;
}

export interface ModelsDevProvider {
  name: string;
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
