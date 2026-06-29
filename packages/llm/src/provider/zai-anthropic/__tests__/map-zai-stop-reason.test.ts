import { describe, expect, it } from "vite-plus/test";
import { mapZaiStopReason } from "../map-zai-stop-reason.ts";

describe("mapZaiStopReason", () => {
  it("maps end_turn / stop_sequence / pause_turn to stop", () => {
    for (const r of ["end_turn", "stop_sequence", "pause_turn"]) {
      expect(mapZaiStopReason({ finishReason: r })).toBe("stop");
    }
  });

  it("maps tool_use to tool-calls", () => {
    expect(mapZaiStopReason({ finishReason: "tool_use" })).toBe("tool-calls");
  });

  it("maps max_tokens + model_context_window_exceeded to length", () => {
    expect(mapZaiStopReason({ finishReason: "max_tokens" })).toBe("length");
    expect(
      mapZaiStopReason({ finishReason: "model_context_window_exceeded" })
    ).toBe("length");
  });

  it("maps refusal to content-filter", () => {
    expect(mapZaiStopReason({ finishReason: "refusal" })).toBe(
      "content-filter"
    );
  });

  it("maps unknown to other", () => {
    expect(mapZaiStopReason({ finishReason: "wat" })).toBe("other");
    expect(mapZaiStopReason({ finishReason: null })).toBe("other");
    expect(mapZaiStopReason({ finishReason: undefined })).toBe("other");
  });
});
