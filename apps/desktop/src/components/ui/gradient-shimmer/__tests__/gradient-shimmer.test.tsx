import { render } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vite-plus/test";
import { GradientShimmer } from "../gradient-shimmer";

vi.mock("../visibility", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../visibility")>();
  return {
    ...actual,
    // jsdom doesn't have window.CSS, so the real check returns false.
    // Mock it true so the effect doesn't strip background-image styles.
    supportsBackgroundClipText: () => true,
    prefersReducedMotion: () => false,
    observeShimmerActive: () => () => undefined,
  };
});

describe("GradientShimmer", () => {
  it("renders children text content", () => {
    const { container } = render(() => <GradientShimmer>Hello</GradientShimmer>);
    expect(container.textContent).toContain("Hello");
  });

  it("renders as span", () => {
    const { container } = render(() => <GradientShimmer>Test</GradientShimmer>);
    const el = container.querySelector("span");
    expect(el).toBeTruthy();
    expect(el?.textContent).toBe("Test");
  });

  it("applies inline-block display", () => {
    const { container } = render(() => <GradientShimmer>Test</GradientShimmer>);
    const el = container.querySelector("span");
    expect(el).toBeTruthy();
    expect(el!.style.display).toBe("inline-block");
  });

  it("sets --gs-base custom property", () => {
    const { container } = render(() => <GradientShimmer>Test</GradientShimmer>);
    const el = container.querySelector("span");
    expect(el).toBeTruthy();
    expect(el!.style.getPropertyValue("--gs-base")).toBe("currentColor");
  });

  it("sets --gs-spread from children length", () => {
    const { container } = render(() => <GradientShimmer>Test</GradientShimmer>);
    const el = container.querySelector("span");
    expect(el).toBeTruthy();
    const spread = el!.style.getPropertyValue("--gs-spread");
    expect(spread).toContain("px");
    expect(Number.parseFloat(spread)).toBeGreaterThan(0);
  });

  it("sets background-image to a linear-gradient", () => {
    const { container } = render(() => <GradientShimmer>Test</GradientShimmer>);
    const el = container.querySelector("span");
    expect(el).toBeTruthy();
    expect(el!.style.getPropertyValue("background-image")).toContain("linear-gradient");
  });

  it("sets background-clip to text", () => {
    const { container } = render(() => <GradientShimmer>Test</GradientShimmer>);
    const el = container.querySelector("span");
    expect(el).toBeTruthy();
    expect(el!.style.getPropertyValue("background-clip")).toBe("text");
  });

  it("sets -webkit-text-fill-color to transparent", () => {
    const { container } = render(() => <GradientShimmer>Test</GradientShimmer>);
    const el = container.querySelector("span");
    expect(el).toBeTruthy();
    expect(el!.style.getPropertyValue("-webkit-text-fill-color")).toBe("transparent");
  });

  it("applies custom class", () => {
    const { container } = render(() => <GradientShimmer class="my-shimmer">Test</GradientShimmer>);
    const el = container.querySelector("span");
    expect(el).toBeTruthy();
    expect(el!.className).toContain("my-shimmer");
  });

  it("accepts custom baseColor", () => {
    const { container } = render(() => <GradientShimmer baseColor="#ff0000">Test</GradientShimmer>);
    const el = container.querySelector("span");
    expect(el).toBeTruthy();
    expect(el!.style.getPropertyValue("--gs-base")).toBe("#ff0000");
  });

  it("renders gradient with preset name", () => {
    const { container } = render(() => <GradientShimmer gradient="mint">Test</GradientShimmer>);
    const el = container.querySelector("span");
    expect(el).toBeTruthy();
    expect(el!.style.getPropertyValue("background-image")).toContain("linear-gradient");
  });

  it("renders gradient with explicit stops", () => {
    const { container } = render(() => (
      <GradientShimmer
        gradient={[
          { color: "#ff0000", position: 0 },
          { color: "#00ff00", position: 1 },
        ]}
      >
        Test
      </GradientShimmer>
    ));
    const el = container.querySelector("span");
    expect(el).toBeTruthy();
    const bg = el!.style.getPropertyValue("background-image");
    expect(bg).toContain("#ff0000");
    expect(bg).toContain("#00ff00");
  });

  it("spreads custom style props onto element", () => {
    const { container } = render(() => (
      <GradientShimmer style={{ "margin-top": "10px" }}>Test</GradientShimmer>
    ));
    const el = container.querySelector("span");
    expect(el).toBeTruthy();
    expect(el!.style.getPropertyValue("margin-top")).toBe("10px");
  });
});
