/**
 * Directories never useful in search results (VCS, deps, build output).
 * Single source of truth — consumed by both the find and grep tools.
 * NOTE: rg multi-glob is last-match-wins, so an include glob MUST be passed
 * BEFORE these negation globs, or matching files inside these dirs get
 * re-included.
 */
export const EXCLUDE_GLOBS = [
  "**/.git/**",
  "**/node_modules/**",
  "**/target/**", // Rust
  "**/dist/**", // generic build output / TS
  "**/build/**", // generic
  "**/.next/**", // Next.js
  "**/out/**", // Next.js export / generic
];
