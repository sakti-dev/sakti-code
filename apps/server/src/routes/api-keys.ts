import { Elysia, t } from "elysia";
import {
  type ApiKeyInfo,
  type ApiKeyStore,
  COMMON_PROVIDERS,
} from "../lib/api-key-store.ts";

export function createApiKeyRoutes(store: ApiKeyStore) {
  return new Elysia({
    name: "routes.api-keys",
    prefix: "/api/api-keys",
  })
    .get("/", () => store.list(), {
      response: t.Array(
        t.Object({
          provider: t.String(),
          envVar: t.String(),
          hasKey: t.Boolean(),
          maskedKey: t.Union([t.String(), t.Null()]),
        })
      ),
    })
    .get("/providers", () => [...COMMON_PROVIDERS], {
      response: t.Array(t.String()),
    })
    .put(
      "/:provider",
      ({ params, body, set }) => {
        const ok = store.set(params.provider, body.key);
        if (!ok) {
          set.status = 400;
          return { error: "Unknown provider or empty key" };
        }
        set.status = 204;
        return null;
      },
      {
        body: t.Object({ key: t.String() }),
        response: {
          204: t.Null(),
          400: t.Object({ error: t.String() }),
        },
      }
    )
    .delete(
      "/:provider",
      ({ params, set }) => {
        const ok = store.delete(params.provider);
        if (!ok) {
          set.status = 404;
          return { error: "Key not found" };
        }
        set.status = 204;
        return null;
      },
      {
        response: {
          204: t.Null(),
          404: t.Object({ error: t.String() }),
        },
      }
    );
}

export type ApiKeyRoutes = ReturnType<typeof createApiKeyRoutes>;
export type { ApiKeyInfo };
