/**
 * Resolve the working directory for a session. Missions with a worktreePath
 * run in their isolated git worktree; everything else (plan sessions,
 * pre-isolation missions) runs on the project's cwd. Single source of truth
 * for cwd — the runner routes all cwd usage through this.
 */
export function resolveSessionCwd(
  session: { worktreePath: string | null },
  project: { cwd: string },
): string {
  return session.worktreePath ?? project.cwd;
}
