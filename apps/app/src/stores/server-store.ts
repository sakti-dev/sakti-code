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
  addProject: (project: Project) => void;
  addSession: (session: SessionMeta) => void;
  removeProject: (projectId: string) => void;
  removeSession: (sessionId: string) => void;
  setActiveProject: (projectId: string | null) => void;
  setActiveSession: (sessionId: string | null) => void;
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
    addProject(project) {
      setStore("projects", project.id, project);
      setStore("projectOrder", (prev) => [...prev, project.id]);
    },

    setConnectionStatus(status) {
      setStore("connection", "status", status);
    },

    setProjects(projects) {
      for (const key of Object.keys(store.projects)) {
        // biome-ignore lint/suspicious/noExplicitAny: SolidJS store deletion requires any cast
        setStore("projects", key, undefined as any);
      }
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
      for (const key of Object.keys(store.sessions)) {
        // biome-ignore lint/suspicious/noExplicitAny: SolidJS store deletion requires any cast
        setStore("sessions", key, undefined as any);
      }
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

    removeProject(projectId) {
      // biome-ignore lint/suspicious/noExplicitAny: SolidJS store deletion requires any cast
      setStore("projects", projectId, undefined as any);
      setStore("projectOrder", (prev) => prev.filter((id) => id !== projectId));
    },
  };

  return { store, actions };
}
