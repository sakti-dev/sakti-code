import { renderHook } from "@solidjs/testing-library";
import { describe, expect, it } from "vite-plus/test";
import { useListNavigation } from "../use-list-navigation.ts";

const items = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("useListNavigation", () => {
  it("starts at index 0 and moves down with wrap-around", () => {
    const { result } = renderHook(() => useListNavigation(() => items));
    expect(result.activeIndex()).toBe(0);
    result.handleKeyDown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    expect(result.activeIndex()).toBe(1);
    result.handleKeyDown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    result.handleKeyDown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    expect(result.activeIndex()).toBe(0);
  });

  it("moves up with wrap-around", () => {
    const { result } = renderHook(() => useListNavigation(() => items));
    result.handleKeyDown(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    expect(result.activeIndex()).toBe(2);
  });

  it("Enter calls onPick with the active item id", () => {
    let picked: string | undefined;
    const { result } = renderHook(() =>
      useListNavigation(() => items, { onPick: (item) => (picked = item.id) }),
    );
    result.handleKeyDown(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    result.handleKeyDown(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(picked).toBe("b");
  });

  it("Escape calls onClose", () => {
    let closed = false;
    const { result } = renderHook(() =>
      useListNavigation(() => items, { onClose: () => (closed = true) }),
    );
    result.handleKeyDown(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(closed).toBe(true);
  });

  it("ignores keys when the list is empty", () => {
    const { result } = renderHook(() => useListNavigation(() => []));
    expect(() =>
      result.handleKeyDown(new KeyboardEvent("keydown", { key: "Enter" })),
    ).not.toThrow();
  });
});
