export type Result<A, E = never> =
  | { readonly _tag: "Success"; readonly success: A }
  | { readonly _tag: "Failure"; readonly failure: E };

export function ok<A, E = never>(value: A): Result<A, E> {
  return { _tag: "Success", success: value };
}

export function err<A, E = never>(error: E): Result<A, E> {
  return { _tag: "Failure", failure: error };
}

export function getOrThrow<A, E>(result: Result<A, E>): A {
  if (result._tag === "Failure") {
    throw result.failure;
  }
  return result.success;
}

export function getOrUndefined<A extends object, E>(
  result: Result<A, E>
): A | undefined {
  return result._tag === "Success" ? result.success : undefined;
}

export function isSuccess<A, E>(
  result: Result<A, E>
): result is { readonly _tag: "Success"; readonly success: A } {
  return result._tag === "Success";
}

export function isFailure<A, E>(
  result: Result<A, E>
): result is { readonly _tag: "Failure"; readonly failure: E } {
  return result._tag === "Failure";
}

export function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "string") {
    return new Error(error);
  }
  try {
    return new Error(JSON.stringify(error));
  } catch {
    return new Error(String(error));
  }
}
