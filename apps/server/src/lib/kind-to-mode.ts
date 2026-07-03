export type ProfileMode = "build" | "default" | "intake" | "observe" | "plan" | "reflect";

/**
 * Map a session kind to a profile mode for model resolution.
 * `mission` -> `default`; other kinds map 1:1 if they exist as modes.
 * Unknown kinds fall back to `default`.
 */
export function kindToMode(kind: string): ProfileMode {
  switch (kind) {
    case "intake":
      return "intake";
    case "plan":
      return "plan";
    case "build":
      return "build";
    default:
      return "default";
  }
}
