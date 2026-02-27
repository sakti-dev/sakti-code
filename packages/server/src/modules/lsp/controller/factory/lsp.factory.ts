import { getLspStatusUsecase } from "../../application/usecases/get-lsp-status.usecase.js";

export function buildLspUsecases() {
  return { getLspStatusUsecase };
}
