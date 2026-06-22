import { tbValidator } from "@hono/typebox-validator";
import { Hono } from "hono";
import Type from "typebox";
import {
  type ApiKeyInfo,
  type ApiKeyStore,
  COMMON_PROVIDERS,
} from "../lib/api-key-store.ts";

export function createApiKeyRoutes(store: ApiKeyStore) {
  return new Hono()
    .basePath("/api/api-keys")
    .get("/", (c) => c.json(store.list()))
    .get("/providers", (c) => c.json([...COMMON_PROVIDERS]))
    .put(
      "/:provider",
      tbValidator("json", Type.Object({ key: Type.String() })),
      (c) => {
        const provider = c.req.param("provider");
        const body = c.req.valid("json");
        const ok = store.set(provider, body.key);
        if (!ok) {
          return c.json({ error: "Unknown provider or empty key" }, 400);
        }
        return c.body(null, 204);
      }
    )
    .delete("/:provider", (c) => {
      const ok = store.delete(c.req.param("provider"));
      if (!ok) {
        return c.json({ error: "Key not found" }, 404);
      }
      return c.body(null, 204);
    });
}

export type ApiKeyRoutes = ReturnType<typeof createApiKeyRoutes>;
export type { ApiKeyInfo };
