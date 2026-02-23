/**
 * Permission Store Tests
 */

import {
  createEmptyPermissionState,
  createPermissionStore,
  type PermissionRequest,
} from "@/core/state/stores/permission-store";
import { describe, expect, it } from "vitest";

describe("Permission Store", () => {
  const createSamplePermission = (overrides?: Partial<PermissionRequest>): PermissionRequest => ({
    id: "perm-1",
    sessionID: "session-1",
    messageID: "msg-1",
    toolName: "bash",
    args: { command: "ls -la" },
    description: "List directory contents",
    status: "pending",
    timestamp: Date.now(),
    ...overrides,
  });

  describe("createEmptyPermissionState", () => {
    it("creates empty state", () => {
      const state = createEmptyPermissionState();
      expect(state.byId).toEqual({});
      expect(state.bySession).toEqual({});
      expect(state.pendingOrder).toEqual([]);
    });
  });

  describe("add", () => {
    it("adds permission to byId", () => {
      const [state, actions] = createPermissionStore();
      const permission = createSamplePermission();

      actions.add(permission);

      expect(state.byId["perm-1"]).toEqual(permission);
    });

    it("adds permission to session grouping", () => {
      const [state, actions] = createPermissionStore();
      const permission = createSamplePermission();

      actions.add(permission);

      expect(state.bySession["session-1"]).toContain("perm-1");
    });

    it("adds pending permission to pendingOrder", () => {
      const [state, actions] = createPermissionStore();
      const permission = createSamplePermission({ status: "pending" });

      actions.add(permission);

      expect(state.pendingOrder).toContain("perm-1");
    });

    it("does not add non-pending permission to pendingOrder", () => {
      const [state, actions] = createPermissionStore();
      const permission = createSamplePermission({ status: "approved" });

      actions.add(permission);

      expect(state.pendingOrder).not.toContain("perm-1");
    });

    it("reconciles session and pending indexes when re-adding existing ID", () => {
      const [state, actions] = createPermissionStore();
      actions.add(
        createSamplePermission({ id: "perm-1", sessionID: "session-1", status: "pending" })
      );
      actions.add(
        createSamplePermission({ id: "perm-1", sessionID: "session-2", status: "approved" })
      );

      expect(state.bySession["session-1"]).not.toContain("perm-1");
      expect(state.bySession["session-2"]).toContain("perm-1");
      expect(state.pendingOrder).not.toContain("perm-1");
      expect(state.byId["perm-1"].status).toBe("approved");
    });
  });

  describe("approve", () => {
    it("approves pending permission", () => {
      const [state, actions] = createPermissionStore();
      const permission = createSamplePermission({ status: "pending" });
      actions.add(permission);

      actions.approve("perm-1");

      expect(state.byId["perm-1"].status).toBe("approved");
    });

    it("removes approved permission from pendingOrder", () => {
      const [state, actions] = createPermissionStore();
      const permission = createSamplePermission({ status: "pending" });
      actions.add(permission);

      actions.approve("perm-1");

      expect(state.pendingOrder).not.toContain("perm-1");
    });
  });

  describe("deny", () => {
    it("denies pending permission", () => {
      const [state, actions] = createPermissionStore();
      const permission = createSamplePermission({ status: "pending" });
      actions.add(permission);

      actions.deny("perm-1");

      expect(state.byId["perm-1"].status).toBe("denied");
    });

    it("removes denied permission from pendingOrder", () => {
      const [state, actions] = createPermissionStore();
      const permission = createSamplePermission({ status: "pending" });
      actions.add(permission);

      actions.deny("perm-1");

      expect(state.pendingOrder).not.toContain("perm-1");
    });
  });

  describe("resolve", () => {
    it("resolves with approval when approved=true", () => {
      const [state, actions] = createPermissionStore();
      const permission = createSamplePermission({ status: "pending" });
      actions.add(permission);

      actions.resolve("perm-1", true);

      expect(state.byId["perm-1"].status).toBe("approved");
    });

    it("resolves with denial when approved=false", () => {
      const [state, actions] = createPermissionStore();
      const permission = createSamplePermission({ status: "pending" });
      actions.add(permission);

      actions.resolve("perm-1", false);

      expect(state.byId["perm-1"].status).toBe("denied");
    });
  });

  describe("getBySession", () => {
    it("returns permissions for session", () => {
      const [, actions] = createPermissionStore();
      const perm1 = createSamplePermission({ id: "perm-1", sessionID: "session-1" });
      const perm2 = createSamplePermission({ id: "perm-2", sessionID: "session-1" });
      const perm3 = createSamplePermission({ id: "perm-3", sessionID: "session-2" });

      actions.add(perm1);
      actions.add(perm2);
      actions.add(perm3);

      const session1Permissions = actions.getBySession("session-1");
      expect(session1Permissions).toHaveLength(2);
      expect(session1Permissions.map(p => p.id)).toContain("perm-1");
      expect(session1Permissions.map(p => p.id)).toContain("perm-2");
    });

    it("returns empty array for non-existent session", () => {
      const [, actions] = createPermissionStore();
      expect(actions.getBySession("non-existent")).toEqual([]);
    });
  });

  describe("getPending", () => {
    it("returns only pending permissions", () => {
      const [, actions] = createPermissionStore();
      const pending = createSamplePermission({ id: "perm-1", status: "pending" });
      const approved = createSamplePermission({ id: "perm-2", status: "approved" });

      actions.add(pending);
      actions.add(approved);

      const pendingPermissions = actions.getPending();
      expect(pendingPermissions).toHaveLength(1);
      expect(pendingPermissions[0].id).toBe("perm-1");
    });
  });

  describe("getById", () => {
    it("returns permission by ID", () => {
      const [, actions] = createPermissionStore();
      const permission = createSamplePermission();
      actions.add(permission);

      expect(actions.getById("perm-1")).toEqual(permission);
    });

    it("returns undefined for non-existent ID", () => {
      const [, actions] = createPermissionStore();
      expect(actions.getById("non-existent")).toBeUndefined();
    });
  });

  describe("remove", () => {
    it("removes permission from byId", () => {
      const [state, actions] = createPermissionStore();
      const permission = createSamplePermission();
      actions.add(permission);

      actions.remove("perm-1");

      expect(state.byId["perm-1"]).toBeUndefined();
    });

    it("removes permission from session grouping", () => {
      const [state, actions] = createPermissionStore();
      const permission = createSamplePermission();
      actions.add(permission);

      actions.remove("perm-1");

      expect(state.bySession["session-1"]).not.toContain("perm-1");
    });

    it("removes permission from pendingOrder", () => {
      const [state, actions] = createPermissionStore();
      const permission = createSamplePermission({ status: "pending" });
      actions.add(permission);

      actions.remove("perm-1");

      expect(state.pendingOrder).not.toContain("perm-1");
    });
  });

  describe("clearResolved", () => {
    it("removes resolved permissions for session", () => {
      const [state, actions] = createPermissionStore();
      const pending = createSamplePermission({ id: "perm-1", status: "pending" });
      const approved = createSamplePermission({ id: "perm-2", status: "approved" });
      const denied = createSamplePermission({ id: "perm-3", status: "denied" });

      actions.add(pending);
      actions.add(approved);
      actions.add(denied);

      actions.clearResolved("session-1");

      expect(state.byId["perm-1"]).toBeDefined(); // pending remains
      expect(state.byId["perm-2"]).toBeUndefined(); // approved removed
      expect(state.byId["perm-3"]).toBeUndefined(); // denied removed
    });
  });
});
