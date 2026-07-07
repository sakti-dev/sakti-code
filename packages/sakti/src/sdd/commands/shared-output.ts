/**
 * Shared JSON/failure output plumbing for command groups whose errors
 * carry the Diagnostic envelope. One definition of the failure
 * contract: exit code 1, Error:/Fix: lines in human mode, a status
 * array in JSON mode.
 */
import { SaktiError, type Diagnostic } from "../core/errors.js";

export function printJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

export function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function asStatus(error: unknown, fallbackCode: string): Diagnostic {
  if (error instanceof SaktiError) {
    return error.diagnostic;
  }
  // RootSelectionError (and siblings) carry the same envelope without
  // sharing a class hierarchy; duck-type the diagnostic once, here.
  const diagnostic = (error as { diagnostic?: Diagnostic }).diagnostic;
  if (diagnostic && typeof diagnostic.code === "string") {
    return diagnostic;
  }
  return {
    severity: "error",
    code: fallbackCode,
    message: asErrorMessage(error),
  };
}

export function emitFailure(
  json: boolean | undefined,
  payload: Record<string, unknown>,
  error: unknown,
  fallbackCode: string,
): void {
  const status = asStatus(error, fallbackCode);
  if (json) {
    const prior = Array.isArray(payload.status) ? payload.status : [];
    printJson({ ...payload, status: [...prior, status] });
    process.exitCode = 1;
    return;
  }
  console.error(`Error: ${status.message}`);
  if (status.fix) {
    console.error(`Fix: ${status.fix}`);
  }
  process.exitCode = 1;
}
