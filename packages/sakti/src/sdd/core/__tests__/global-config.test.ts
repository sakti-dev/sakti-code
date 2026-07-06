import { describe, expect, it } from "vitest";

import { getGlobalDataDir } from "../global-config.js";

describe("getGlobalDataDir", () => {
  it("uses POSIX separators for Unix-like platform overrides", () => {
    expect(
      getGlobalDataDir({
        env: {},
        platform: "linux",
        homedir: "/home/tabish",
      }),
    ).toBe("/home/tabish/.local/share/sakti");

    expect(
      getGlobalDataDir({
        env: { XDG_DATA_HOME: "/var/data" },
        platform: "darwin",
        homedir: "/Users/tabish",
      }),
    ).toBe("/var/data/sakti");
  });

  it("uses Windows separators for native Windows platform overrides", () => {
    expect(
      getGlobalDataDir({
        env: {},
        platform: "win32",
        homedir: "C:\\Users\\Tabish",
      }),
    ).toBe("C:\\Users\\Tabish\\AppData\\Local\\sakti");

    expect(
      getGlobalDataDir({
        env: { LOCALAPPDATA: "D:\\Users\\Tabish\\AppData\\Local" },
        platform: "win32",
        homedir: "C:\\Users\\Tabish",
      }),
    ).toBe("D:\\Users\\Tabish\\AppData\\Local\\sakti");
  });
});
