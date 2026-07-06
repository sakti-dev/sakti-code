export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  target?: string;
  fix?: string;
}

export class SaktiError extends Error {
  readonly diagnostic: Diagnostic;

  constructor(message: string, code: string, options: { target?: string; fix?: string } = {}) {
    super(message);
    this.name = "SaktiError";
    this.diagnostic = {
      severity: "error",
      code,
      message,
      ...options,
    };
  }
}

export function makeDiagnostic(
  severity: DiagnosticSeverity,
  code: string,
  message: string,
  options: { target?: string; fix?: string } = {},
): Diagnostic {
  return {
    severity,
    code,
    message,
    ...options,
  };
}
