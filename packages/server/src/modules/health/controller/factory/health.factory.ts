import { getHealthUsecase } from "../../application/usecases/get-health.usecase.js";

export function buildHealthUsecases() {
  return { getHealthUsecase };
}
