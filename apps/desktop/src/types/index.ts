export interface RecentProject {
  id: string;
  name: string;
  path: string;
  lastOpened: Date;
}

export type ProjectAction = "open" | "clone" | "remove";
export type AgentMode = "plan" | "build";

export interface WorkspaceState {
  projectId: string;
  path: string;
  name: string;
}

export interface AppSettings {
  theme: "light" | "dark";
  recentProjects: RecentProject[];
}

/* ============================================================
   LUMINOUS WORKSPACE - Session & Chat Types
   ============================================================ */

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  status: "pending" | "running" | "completed" | "failed";
  result?: unknown;
  error?: string;
  timestamp: Date;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  toolCalls?: ToolCall[];
  thinking?: string; // Collapsible thought chain
}

export interface Session {
  id: string;
  title: string;
  messages: Message[];
  projectId?: string;
  lastUpdated: Date;
  status: "active" | "archived";
  isPinned?: boolean;
}

export interface FileTab {
  id: string;
  path: string;
  name: string;
  isModified: boolean;
  isActive: boolean;
}

export interface DiffChange {
  id: string;
  type: "addition" | "removal" | "modification";
  filePath: string;
  lineNumber: number;
  oldContent?: string;
  newContent?: string;
  status: "pending" | "accepted" | "rejected";
}

export interface TerminalOutput {
  timestamp: Date;
  type: "info" | "warn" | "error" | "success";
  content: string;
}
