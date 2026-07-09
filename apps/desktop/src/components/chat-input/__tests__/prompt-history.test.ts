import { describe, expect, it } from "vite-plus/test";
import {
  historyDown,
  historyCurrent,
  historyUp,
  initialHistoryNav,
  type HistoryNavState,
} from "../prompt-history";

const s = (index: number, draft: string): HistoryNavState => ({ index, draft });

describe("prompt history nav", () => {
  it("up from null saves the draft and jumps to newest (index 0)", () => {
    const next = historyUp(initialHistoryNav, ["a", "b"], "draft!");
    expect(next).toEqual(s(0, "draft!"));
    expect(historyCurrent(next, ["a", "b"])).toBe("a");
  });

  it("repeated up moves older and clamps at the oldest", () => {
    let st = historyUp(initialHistoryNav, ["a", "b", "c"], "d");
    st = historyUp(st, ["a", "b", "c"], "d");
    expect(historyCurrent(st, ["a", "b", "c"])).toBe("b");
    st = historyUp(st, ["a", "b", "c"], "d");
    st = historyUp(st, ["a", "b", "c"], "d");
    expect(historyCurrent(st, ["a", "b", "c"])).toBe("c");
  });

  it("down moves newer and below 0 restores the draft", () => {
    let st = historyUp(initialHistoryNav, ["a", "b"], "my draft");
    st = historyUp(st, ["a", "b"], "my draft");
    st = historyDown(st);
    expect(historyCurrent(st, ["a", "b"])).toBe("a");
    st = historyDown(st);
    expect(st.index).toBe(-1);
    expect(st.draft).toBe("my draft");
  });

  it("up with empty list is a no-op", () => {
    expect(historyUp(initialHistoryNav, [], "x")).toEqual(initialHistoryNav);
  });

  it("down when not navigating is a no-op", () => {
    expect(historyDown(initialHistoryNav)).toEqual(initialHistoryNav);
  });
});
