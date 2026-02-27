import {
  approvePermissionUsecase,
  clearSessionPermissionsUsecase,
  listPendingPermissionsUsecase,
} from "../../application/usecases/manage-permissions.usecase.js";

export function buildPermissionUsecases() {
  return {
    approvePermissionUsecase,
    listPendingPermissionsUsecase,
    clearSessionPermissionsUsecase,
  };
}
