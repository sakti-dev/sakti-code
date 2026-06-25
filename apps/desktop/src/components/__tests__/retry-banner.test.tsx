import { render } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import type { RetryState } from "../../stores/types.ts";
import { RetryBanner } from "../chat-area/retry-banner.tsx";

// Top-level regexes (biome useTopLevelRegex).
const RETRYING_IN_4S = /Retrying in 4s/;
const ATTEMPT_2_OF_3 = /attempt 2 of 3/;

function makeRetry(overrides: Partial<RetryState> = {}): RetryState {
  return {
    attempt: 1,
    delayMs: 2000,
    errorMessage: "429 rate limited",
    maxAttempts: 3,
    ...overrides,
  };
}

describe("RetryBanner", () => {
  it("renders the error message", () => {
    const { getByText } = render(() => (
      <RetryBanner onCancel={vi.fn()} retry={makeRetry()} />
    ));
    expect(getByText("429 rate limited")).toBeTruthy();
  });

  it("renders attempt count and computed delay", () => {
    const { getByText } = render(() => (
      <RetryBanner
        onCancel={vi.fn()}
        retry={makeRetry({ attempt: 2, delayMs: 4000, maxAttempts: 3 })}
      />
    ));
    // "Retrying in 4s · attempt 2 of 3"
    expect(getByText(RETRYING_IN_4S)).toBeTruthy();
    expect(getByText(ATTEMPT_2_OF_3)).toBeTruthy();
  });

  it("calls onCancel when Cancel is clicked", async () => {
    const onCancel = vi.fn();
    const { getByRole } = render(() => (
      <RetryBanner onCancel={onCancel} retry={makeRetry()} />
    ));
    const btn = getByRole("button", { name: "Cancel" });
    btn.click();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
