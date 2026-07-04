import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

// Reset module state between tests — the store uses createRoot/createSignal
// at module level, so we need fresh imports.
async function freshStore() {
  vi.resetModules();
  localStorage.clear();
  return await import("../session-tab-store.ts");
}

describe("session-tab-store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("ensureProjectTabs", () => {
    it("creates a Home tab for a new project", async () => {
      const store = await freshStore();
      store.ensureProjectTabs("p1");
      expect(store.getSessionTabs("p1")).toEqual([{ kind: "home", sessionId: null }]);
      expect(store.getActiveSessionIndex("p1")).toBe(0);
    });

    it("does not duplicate if Home already exists", async () => {
      const store = await freshStore();
      store.ensureProjectTabs("p1");
      store.ensureProjectTabs("p1");
      expect(store.getSessionTabs("p1")).toEqual([{ kind: "home", sessionId: null }]);
    });
  });

  describe("openSessionTab", () => {
    it("adds an intake tab after Home", async () => {
      const store = await freshStore();
      store.ensureProjectTabs("p1");
      store.openSessionTab("p1", "s1", "intake");
      expect(store.getSessionTabs("p1")).toEqual([
        { kind: "home", sessionId: null },
        { kind: "intake", sessionId: "s1" },
      ]);
      expect(store.getActiveSessionIndex("p1")).toBe(1);
    });

    it("activates existing tab instead of duplicating", async () => {
      const store = await freshStore();
      store.ensureProjectTabs("p1");
      store.openSessionTab("p1", "s1", "intake");
      store.openSessionTab("p1", "s2", "mission");
      store.openSessionTab("p1", "s1", "intake");
      expect(store.getSessionTabs("p1")).toHaveLength(3);
      expect(store.getActiveSessionIndex("p1")).toBe(1);
    });

    it("updates kind if session changes kind (intake to mission morph)", async () => {
      const store = await freshStore();
      store.ensureProjectTabs("p1");
      store.openSessionTab("p1", "s1", "intake");
      store.openSessionTab("p1", "s1", "mission");
      expect(store.getSessionTabs("p1")).toEqual([
        { kind: "home", sessionId: null },
        { kind: "mission", sessionId: "s1" },
      ]);
    });
  });

  describe("closeSessionTab", () => {
    it("closes a non-Home tab", async () => {
      const store = await freshStore();
      store.ensureProjectTabs("p1");
      store.openSessionTab("p1", "s1", "intake");
      store.openSessionTab("p1", "s2", "mission");
      store.closeSessionTab("p1", 1);
      expect(store.getSessionTabs("p1")).toEqual([
        { kind: "home", sessionId: null },
        { kind: "mission", sessionId: "s2" },
      ]);
    });

    it("does NOT close Home (index 0)", async () => {
      const store = await freshStore();
      store.ensureProjectTabs("p1");
      store.closeSessionTab("p1", 0);
      expect(store.getSessionTabs("p1")).toEqual([{ kind: "home", sessionId: null }]);
    });

    it("activates Home when closing the active tab", async () => {
      const store = await freshStore();
      store.ensureProjectTabs("p1");
      store.openSessionTab("p1", "s1", "intake");
      store.closeSessionTab("p1", 1);
      expect(store.getActiveSessionIndex("p1")).toBe(0);
    });

    it("adjusts active index when closing a tab before it", async () => {
      const store = await freshStore();
      store.ensureProjectTabs("p1");
      store.openSessionTab("p1", "s1", "intake");
      store.openSessionTab("p1", "s2", "mission");
      store.switchSessionTab("p1", 2);
      store.closeSessionTab("p1", 1);
      expect(store.getActiveSessionIndex("p1")).toBe(1);
    });
  });

  describe("switchSessionTab", () => {
    it("changes the active index", async () => {
      const store = await freshStore();
      store.ensureProjectTabs("p1");
      store.openSessionTab("p1", "s1", "intake");
      store.switchSessionTab("p1", 0);
      expect(store.getActiveSessionIndex("p1")).toBe(0);
      expect(store.getActiveSessionTab("p1")?.kind).toBe("home");
    });
  });

  describe("filterStaleSessions", () => {
    it("drops tabs whose sessionId no longer exists", async () => {
      const store = await freshStore();
      store.ensureProjectTabs("p1");
      store.openSessionTab("p1", "s1", "intake");
      store.openSessionTab("p1", "s2", "mission");
      store.filterStaleSessions("p1", new Set(["s2"]));
      expect(store.getSessionTabs("p1")).toEqual([
        { kind: "home", sessionId: null },
        { kind: "mission", sessionId: "s2" },
      ]);
    });

    it("keeps Home regardless", async () => {
      const store = await freshStore();
      store.ensureProjectTabs("p1");
      store.filterStaleSessions("p1", new Set());
      expect(store.getSessionTabs("p1")).toEqual([{ kind: "home", sessionId: null }]);
    });
  });

  describe("getActiveSessionTab", () => {
    it("returns null for unknown project", async () => {
      const store = await freshStore();
      expect(store.getActiveSessionTab("nope")).toBeNull();
    });
  });

  describe("getSessionTabIndex", () => {
    it("returns the index of a tab with matching sessionId", async () => {
      const store = await freshStore();
      store.ensureProjectTabs("p1");
      store.openSessionTab("p1", "s1", "intake");
      store.openSessionTab("p1", "s2", "mission");
      expect(store.getSessionTabIndex("p1", "s2")).toBe(2);
    });

    it("returns -1 for unknown sessionId", async () => {
      const store = await freshStore();
      store.ensureProjectTabs("p1");
      expect(store.getSessionTabIndex("p1", "nope")).toBe(-1);
    });
  });
});
