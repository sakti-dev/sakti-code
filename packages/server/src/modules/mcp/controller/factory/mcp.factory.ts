import {
  getMcpStatusUsecase,
  resolveMcpDirectory,
} from "../../application/usecases/get-mcp-status.usecase.js";

export function buildMcpUsecases() {
  return {
    getMcpStatusUsecase,
    resolveMcpDirectory,
  };
}
