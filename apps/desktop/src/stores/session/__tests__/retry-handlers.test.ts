import { describe, expect, it } from "vite-plus/test";
import { setupHandlers } from "./handler-helpers.ts";

describe("retry handlers", () => {
  it("auto_retry_start sets retry state", () => {
    const { session, dispatch } = setupHandlers();
    dispatch({
      attempt: 1,
      delayMs: 2000,
      errorMessage: "rate limited",
      maxAttempts: 3,
      type: "auto_retry_start",
    });

    expect(session.store.retry).toMatchObject({
      attempt: 1,
      delayMs: 2000,
      errorMessage: "rate limited",
      maxAttempts: 3,
    });
  });

  it("auto_retry_end clears retry state", () => {
    const { session, dispatch } = setupHandlers();
    dispatch({
      attempt: 1,
      delayMs: 2000,
      errorMessage: "rate limited",
      maxAttempts: 3,
      type: "auto_retry_start",
    });
    expect(session.store.retry).not.toBeNull();

    dispatch({ attempt: 1, finalError: undefined, success: true, type: "auto_retry_end" });
    expect(session.store.retry).toBeNull();
  });
});
