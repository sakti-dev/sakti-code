import { describe, expect, it } from "vite-plus/test";
import { clearDraftProfile, getDraftProfile, setDraftProfile } from "../draft-profile-store";

describe("draft-profile-store", () => {
  it("returns undefined when no draft is set for a project", () => {
    expect(getDraftProfile("p-none")).toBeUndefined();
  });

  it("stores and retrieves a draft profile per project", () => {
    setDraftProfile("p1", "profile-x");
    expect(getDraftProfile("p1")).toBe("profile-x");
  });

  it("keeps drafts isolated per project", () => {
    setDraftProfile("p1", "profile-a");
    setDraftProfile("p2", "profile-b");
    expect(getDraftProfile("p1")).toBe("profile-a");
    expect(getDraftProfile("p2")).toBe("profile-b");
  });

  it("overwrites a previous draft for the same project", () => {
    setDraftProfile("p1", "profile-a");
    setDraftProfile("p1", "profile-b");
    expect(getDraftProfile("p1")).toBe("profile-b");
  });

  it("clears a draft for a project without affecting others", () => {
    setDraftProfile("p1", "profile-a");
    setDraftProfile("p2", "profile-b");
    clearDraftProfile("p1");
    expect(getDraftProfile("p1")).toBeUndefined();
    expect(getDraftProfile("p2")).toBe("profile-b");
  });

  it("clear is a no-op when no draft exists", () => {
    clearDraftProfile("never-set");
    expect(getDraftProfile("never-set")).toBeUndefined();
  });
});
