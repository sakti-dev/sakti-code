interface ArgDef {
  required?: boolean;
  type: "string" | "number" | "boolean" | "array" | "object";
}

export function validateArgs(
  args: Record<string, unknown>,
  schema: Record<string, ArgDef>,
  toolName: string
):
  | { valid: true; args: Record<string, unknown> }
  | { valid: false; error: string } {
  const result: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(schema)) {
    if (def.required && !(key in args)) {
      return {
        valid: false,
        error: `Missing required argument '${key}' for ${toolName}`,
      };
    }
    if (key in args) {
      const val = args[key];
      const typeOk =
        (def.type === "string" && typeof val === "string") ||
        (def.type === "number" && typeof val === "number") ||
        (def.type === "boolean" && typeof val === "boolean") ||
        (def.type === "array" && Array.isArray(val)) ||
        (def.type === "object" &&
          val !== null &&
          typeof val === "object" &&
          !Array.isArray(val));
      if (!typeOk && val !== undefined) {
        return {
          valid: false,
          error: `Argument '${key}' must be ${def.type}, got ${typeof val}`,
        };
      }
      result[key] = val;
    }
  }
  return { valid: true, args: result };
}

export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
