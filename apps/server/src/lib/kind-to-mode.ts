export type ProfileMode = "build" | "default" | "observe" | "plan" | "reflect" | "spec";

/**
 * Map a session kind to a profile mode for model resolution.
 * `mission` -> `default`; other kinds map 1:1 if they exist as modes.
 * Unknown kinds fall back to `default`.
 */
export function kindToMode(kind: string): ProfileMode {
  switch (kind) {
    case "plan":
      return "plan";
    case "spec":
      return "spec";
    case "build":
      return "build";
    default:
      return "default";
  }
}
