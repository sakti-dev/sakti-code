import { requeueExpiredRuns } from "../../db/task-session-runs";

export async function recoverExpiredTaskRuns(now: Date = new Date()): Promise<number> {
  return requeueExpiredRuns(now);
}
