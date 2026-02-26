export const providerSchemaArtifact = {
  version: "1.0.0",
  endpoints: {
    "/api/providers": {
      get: {
        response: {
          type: "object",
          required: ["providers"],
          properties: {
            providers: { type: "array" },
          },
        },
      },
    },
    "/api/providers/auth": {
      get: {
        response: {
          type: "object",
          additionalProperties: {
            type: "object",
            required: ["providerId", "status", "method", "accountLabel", "updatedAt"],
          },
        },
      },
    },
    "/api/providers/catalog": {
      get: {
        response: {
          type: "object",
          required: ["providers"],
          properties: {
            providers: {
              type: "array",
              items: {
                type: "object",
                required: [
                  "id",
                  "name",
                  "aliases",
                  "authMethods",
                  "connected",
                  "modelCount",
                  "popular",
                ],
                properties: {
                  id: { type: "string" },
                  name: { type: "string" },
                  aliases: { type: "array", items: { type: "string" } },
                  authMethods: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["type", "label"],
                      properties: {
                        type: { type: "string", enum: ["api", "token", "oauth", "none"] },
                        label: { type: "string" },
                        prompts: { type: "array" },
                      },
                    },
                  },
                  connected: { type: "boolean" },
                  modelCount: { type: "number" },
                  popular: { type: "boolean" },
                  supported: { type: "boolean" },
                  note: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
    "/api/providers/auth/methods": {
      get: {
        response: {
          type: "object",
          additionalProperties: {
            type: "array",
            items: {
              type: "object",
              required: ["type", "label"],
              properties: {
                type: { type: "string", enum: ["api", "token", "oauth", "none"] },
                label: { type: "string" },
                prompts: { type: "array" },
              },
            },
          },
        },
      },
    },
    "/api/providers/models": {
      get: {
        response: {
          type: "object",
          required: ["models"],
          properties: {
            models: { type: "array" },
          },
        },
      },
    },
    "/api/providers/preferences": {
      get: {
        response: {
          type: "object",
          required: ["selectedProviderId", "selectedModelId", "updatedAt"],
          properties: {
            selectedProviderId: { type: ["string", "null"] },
            selectedModelId: { type: ["string", "null"] },
            updatedAt: { type: "string" },
          },
        },
      },
      put: {
        request: {
          type: "object",
          properties: {
            selectedProviderId: { type: ["string", "null"] },
            selectedModelId: { type: ["string", "null"] },
          },
        },
        response: {
          type: "object",
          required: ["selectedProviderId", "selectedModelId", "updatedAt"],
          properties: {
            selectedProviderId: { type: ["string", "null"] },
            selectedModelId: { type: ["string", "null"] },
            updatedAt: { type: "string" },
          },
        },
      },
    },
    "/api/providers/{providerId}/auth/token": {
      post: {
        request: {
          type: "object",
          required: ["token"],
          properties: {
            token: { type: "string" },
          },
        },
      },
      delete: {
        response: {
          type: "object",
          required: ["ok"],
          properties: { ok: { type: "boolean" } },
        },
      },
    },
    "/api/providers/{providerId}/oauth/authorize": {
      post: {
        request: {
          type: "object",
          required: ["method"],
          properties: {
            method: { type: "number" },
            inputs: { type: "object" },
          },
        },
        response: {
          type: "object",
          required: ["providerId", "authorizationId", "url", "method", "instructions"],
        },
      },
    },
    "/api/providers/{providerId}/oauth/callback": {
      post: {
        request: {
          type: "object",
          required: ["method", "authorizationId"],
          properties: {
            method: { type: "number" },
            authorizationId: { type: "string" },
            code: { type: "string" },
          },
        },
        response: {
          type: "object",
          required: ["status"],
          properties: {
            status: { type: "string", enum: ["pending", "connected"] },
          },
        },
      },
    },
  },
} as const;
