export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: "open" | "in_progress" | "closed";
  priority: number;
  type: string;
  assignee: string | null;
  session_id: string | null;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
  close_reason: string | null;
  summary: string | null;
  metadata: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface NewTask {
  title?: string;
  description?: string | null;
  status?: "open" | "in_progress" | "closed";
  priority?: number;
  type?: string;
  assignee?: string | null;
  session_id?: string | null;
  updated_at?: Date;
  closed_at?: Date | null;
  close_reason?: string | null;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface TaskDependency {
  task_id: string;
  depends_on_id: string;
  type: string;
  created_at: Date;
  [key: string]: unknown;
}

export interface Message {
  id: string;
  thread_id: string;
  resource_id: string | null;
  role: string;
  raw_content: string;
  search_text: string;
  injection_text: string;
  task_id: string | null;
  summary: string | null;
  compaction_level: number;
  created_at: Date;
  message_index: number;
  token_count: number | null;
  [key: string]: unknown;
}

export interface WorkingMemory {
  id: string;
  resource_id: string;
  scope: "resource" | "thread";
  content: string;
  created_at: Date;
  updated_at: Date;
  [key: string]: unknown;
}

export interface NewWorkingMemory {
  content?: string;
  scope?: "resource" | "thread";
  updated_at?: Date;
  [key: string]: unknown;
}

export interface Reflection {
  id: string;
  thread_id: string | null;
  resource_id: string | null;
  content: string;
  merged_from: string[] | null;
  origin_type: string | null;
  generation_count: number;
  token_count: number | null;
  created_at: Date;
  updated_at: Date;
  [key: string]: unknown;
}

export interface ObservationalMemory {
  id: string;
  thread_id: string | null;
  resource_id: string | null;
  scope: "thread" | "resource";
  active_observations: string;
  observed_message_ids: string[] | null;
  buffered_observation_chunks: Array<{
    content: string;
    messageIds: string[];
    messageTokens: number;
    createdAt: Date;
  }> | null;
  config: unknown;
  is_observing: number;
  is_reflecting: number;
  is_buffering_observation: number;
  is_buffering_reflection: number;
  last_buffered_at_tokens: number | null;
  last_buffered_at_time: Date | null;
  lock_owner_id: string | null;
  lock_operation_id: string | null;
  lock_expires_at: Date | null;
  last_heartbeat_at: Date | null;
  generation_count: number;
  updated_at: Date;
  [key: string]: unknown;
}

export interface CoreDbBindings {
  // Bridge boundary: server provides Drizzle runtime objects.
  // `any` is intentionally contained to this seam so core and shared stay decoupled from Drizzle internals.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getDb: () => Promise<any>;
  closeDb?: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sessions: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tasks: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  taskDependencies: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  taskMessages: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  threads: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  messages: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  workingMemory: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  reflections: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  observationalMemory: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  toolSessions: any;
}

export interface TaskUpdatedSummary {
  id: string;
  title: string;
  status: string;
  priority: number;
}

export interface CoreBusBindings {
  publishTaskUpdated: (sessionId: string, tasks: TaskUpdatedSummary[]) => Promise<void>;
}

let dbBindings: CoreDbBindings | null = null;
let busBindings: CoreBusBindings | null = null;

export function registerCoreDbBindings(bindings: CoreDbBindings): void {
  dbBindings = bindings;
}

export function getCoreDbBindings(): CoreDbBindings {
  if (!dbBindings) {
    throw new Error("Core DB bindings not registered. Call registerCoreDbBindings() at startup.");
  }
  return dbBindings;
}

export function registerCoreBusBindings(bindings: CoreBusBindings): void {
  busBindings = bindings;
}

export function getCoreBusBindings(): CoreBusBindings | null {
  return busBindings;
}
