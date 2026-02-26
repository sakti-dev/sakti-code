export interface RecoverExpiredRunsInput {
  now?: Date;
}

export async function recoverExpiredRunsUsecase(
  _input: RecoverExpiredRunsInput = {}
): Promise<number> {
  return 0;
}
