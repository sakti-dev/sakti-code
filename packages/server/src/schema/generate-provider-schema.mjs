import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const artifact = {
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
                type: { type: "string", enum: ["token", "oauth", "none"] },
                label: { type: "string" },
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
};

const baseDir = dirname(fileURLToPath(import.meta.url));
const outputPath = join(baseDir, "provider.schemas.json");
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf-8");
