import { isServer, renderToString } from "solid-js/web";
import { describe, expect, it } from "vitest";
import { Velomark } from "../src";

describe("environment", () => {
  it("runs on server", () => {
    expect(typeof window).toBe("undefined");
    expect(isServer).toBe(true);
  });
});

describe("package surface", () => {
  it("exports the renderer entrypoint instead of starter placeholders", async () => {
    const entry = await import("../src");

    expect(entry).toHaveProperty("Velomark");
    expect(entry).not.toHaveProperty("Hello");
    expect(entry).not.toHaveProperty("createHello");
  });
});

describe("Velomark", () => {
  it("renders markdown on the server", () => {
    const string = renderToString(() => <Velomark markdown={"Hello world"} />);
    expect(string).toContain("data-velomark-root");
    expect(string).toContain('data-velomark-block-kind="paragraph"');
    expect(string).toContain(">Hello world</p>");
  });
});
