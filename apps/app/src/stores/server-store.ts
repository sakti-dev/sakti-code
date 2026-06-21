import { createStore } from "solid-js/store";

export interface Project {
  createdAt: number;
  cwd: string;
  id: string;
  name: string;
  updatedAt: number;
}

export interface SessionMeta {
  createdAt: number;
  id: string;
  modelId: string;
  projectId: string;
  thinkingLevel: string;
  title: string | null;
  updatedAt: number;
}

export interface ServerStoreData {
  activeProjectId: string | null;
  activeSessionId: string | null;
  connection: {
    status: "connecting" | "open" | "closed";
  };
  projectOrder: string[];
  projects: Record<string, Project>;
  sessionOrder: string[];
  sessions: Record<string, SessionMeta>;
}

export interface ServerActions {
  addSession: (session: SessionMeta) => void;
  removeSession: (sessionId: string) => void;
  setActiveProject: (projectId: string) => void;
  setActiveSession: (sessionId: string) => void;
  setConnectionStatus: (
    status: ServerStoreData["connection"]["status"]
  ) => void;
  setProjects: (projects: Project[]) => void;
  setSessions: (sessions: SessionMeta[]) => void;
  updateSession: (sessionId: string, patch: Partial<SessionMeta>) => void;
}

export interface ServerStore {
  actions: ServerActions;
  store: ServerStoreData;
}

export function createServerStore(): ServerStore {
  const [store, setStore] = createStore<ServerStoreData>({
    connection: { status: "connecting" },
    projects: {},
    projectOrder: [],
    activeProjectId: null,
    sessions: {},
    sessionOrder: [],
    activeSessionId: null,
  });

  const actions: ServerActions = {
    setConnectionStatus(status) {
      setStore("connection", "status", status);
    },

    setProjects(projects) {
      setStore("projects", {});
      for (const p of projects) {
        setStore("projects", p.id, p);
      }
      setStore(
        "projectOrder",
        projects.map((p) => p.id)
      );
    },

    setActiveProject(projectId) {
      setStore("activeProjectId", projectId);
    },

    setSessions(sessions) {
      setStore("sessions", {});
      for (const s of sessions) {
        setStore("sessions", s.id, s);
      }
      setStore(
        "sessionOrder",
        sessions.map((s) => s.id)
      );
    },

    addSession(session) {
      setStore("sessions", session.id, session);
      setStore("sessionOrder", (prev) => [...prev, session.id]);
    },

    setActiveSession(sessionId) {
      setStore("activeSessionId", sessionId);
    },

    updateSession(sessionId, patch) {
      setStore("sessions", sessionId, (prev) => ({ ...prev, ...patch }));
    },

    removeSession(sessionId) {
      // biome-ignore lint/suspicious/noExplicitAny: SolidJS store deletion requires any cast
      setStore("sessions", sessionId, undefined as any);
      setStore("sessionOrder", (prev) => prev.filter((id) => id !== sessionId));
    },
  };

  return { store, actions };
}

let singleton: ServerStore | null = null;

export function getServerStore(): ServerStore {
  if (!singleton) {
    singleton = createServerStore();
  }
  return singleton;
}
