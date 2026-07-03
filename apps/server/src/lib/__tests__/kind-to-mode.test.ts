import { describe, expect, it } from "vite-plus/test";
import { kindToMode } from "../kind-to-mode.ts";

describe("kindToMode", () => {
  it("maps 'mission' to 'default'", () => {
    expect(kindToMode("mission")).toBe("default");
  });

  it("maps 'intake' to 'intake'", () => {
    expect(kindToMode("intake")).toBe("intake");
  });

  it("maps 'plan' to 'plan'", () => {
    expect(kindToMode("plan")).toBe("plan");
  });

  it("maps 'build' to 'build'", () => {
    expect(kindToMode("build")).toBe("build");
  });

  it("maps unknown kinds to 'default'", () => {
    expect(kindToMode("unknown")).toBe("default");
    expect(kindToMode("")).toBe("default");
  });
});
