import type { HealthResponse } from "../../../../types.js";

export function getHealthUsecase(): HealthResponse {
  return {
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    version: "0.0.1",
  };
}
