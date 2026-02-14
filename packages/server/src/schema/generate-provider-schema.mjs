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
        response: {
          type: "object",
          required: ["providerId", "state", "url"],
        },
      },
    },
    "/api/providers/{providerId}/oauth/callback": {
      post: {
        request: {
          type: "object",
          properties: { code: { type: "string" } },
        },
      },
    },
  },
};

const baseDir = dirname(fileURLToPath(import.meta.url));
const outputPath = join(baseDir, "provider.schemas.json");
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf-8");
