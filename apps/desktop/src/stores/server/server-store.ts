import { createStore, produce, reconcile } from "solid-js/store";

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
  kind: "intake" | "mission";
  modelId: string | null;
  profileId: string | null;
  projectId: string;
  status: "planning" | "building" | "review" | "merged";
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
  setConnectionStatus: (status: ServerStoreData["connection"]["status"]) => void;
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
      const map: Record<string, Project> = {};
      for (const p of projects) {
        map[p.id] = p;
      }
      setStore("projects", reconcile(map));
      setStore(
        "projectOrder",
        projects.map((p) => p.id),
      );
      const first = projects[0];
      if (store.activeProjectId === null && first) {
        setStore("activeProjectId", first.id);
      }
    },

    setActiveProject(projectId) {
      setStore("activeProjectId", projectId);
    },

    setSessions(sessions) {
      const map: Record<string, SessionMeta> = {};
      for (const s of sessions) {
        map[s.id] = s;
      }
      setStore("sessions", reconcile(map));
      setStore(
        "sessionOrder",
        sessions.map((s) => s.id),
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
      setStore(
        "sessions",
        produce((s) => {
          delete s[sessionId];
        }),
      );
      setStore("sessionOrder", (prev) => prev.filter((id) => id !== sessionId));
    },

    removeProject(projectId) {
      setStore(
        "projects",
        produce((p) => {
          delete p[projectId];
        }),
      );
      setStore("projectOrder", (prev) => prev.filter((id) => id !== projectId));
    },
  };

  return { store, actions };
}
