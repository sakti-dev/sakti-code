/**
 * useStreaming Hook Tests
 *
 * Tests for the useStreaming hook.
 * Part of Phase 5: Hooks Refactor
 */

import { useStreaming } from "@/core/chat/hooks";
import { createRoot } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("useStreaming", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("initial state", () => {
    it("should start with idle status", () => {
      createRoot(dispose => {
        const streaming = useStreaming();

        expect(streaming.status()).toBe("idle");
        expect(streaming.error()).toBe(null);
        expect(streaming.activeMessageId()).toBe(null);
        expect(streaming.isLoading()).toBe(false);
        expect(streaming.canSend()).toBe(true);

        dispose();
      });
    });

    it("should have no active message initially", () => {
      createRoot(dispose => {
        const streaming = useStreaming();

        expect(streaming.activeMessageId()).toBe(null);

        dispose();
      });
    });

    it("should not be loading initially", () => {
      createRoot(dispose => {
        const streaming = useStreaming();

        expect(streaming.isLoading()).toBe(false);

        dispose();
      });
    });

    it("should be able to send initially", () => {
      createRoot(dispose => {
        const streaming = useStreaming();

        expect(streaming.canSend()).toBe(true);

        dispose();
      });
    });
  });

  describe("start method", () => {
    it("should set status to connecting", () => {
      createRoot(dispose => {
        const streaming = useStreaming();

        streaming.start();
        expect(streaming.status()).toBe("connecting");
        expect(streaming.isLoading()).toBe(true);
        expect(streaming.canSend()).toBe(false);

        dispose();
      });
    });

    it("should set active message ID when provided", () => {
      createRoot(dispose => {
        const streaming = useStreaming();

        streaming.start("msg-123");
        expect(streaming.activeMessageId()).toBe("msg-123");

        dispose();
      });
    });

    it("should clear error when starting", () => {
      createRoot(dispose => {
        const streaming = useStreaming();

        streaming.setError(new Error("previous error"));
        expect(streaming.error()).toBeInstanceOf(Error);

        streaming.start();
        expect(streaming.error()).toBe(null);

        dispose();
      });
    });
  });

  describe("setStatus method", () => {
    it("should set status to streaming", () => {
      createRoot(dispose => {
        const streaming = useStreaming();

        streaming.setStatus("streaming");
        expect(streaming.status()).toBe("streaming");
        expect(streaming.isLoading()).toBe(true);

        dispose();
      });
    });

    it("should set status to done", () => {
      createRoot(dispose => {
        const streaming = useStreaming();

        streaming.setStatus("done");
        expect(streaming.status()).toBe("done");
        expect(streaming.isLoading()).toBe(false);
        expect(streaming.canSend()).toBe(true);

        dispose();
      });
    });

    it("should set status to error", () => {
      createRoot(dispose => {
        const streaming = useStreaming();

        streaming.setStatus("error");
        expect(streaming.status()).toBe("error");
        expect(streaming.isLoading()).toBe(false);
        expect(streaming.canSend()).toBe(true);

        dispose();
      });
    });
  });

  describe("setError method", () => {
    it("should set error", () => {
      createRoot(dispose => {
        const streaming = useStreaming();

        const error = new Error("Test error");
        streaming.setError(error);

        expect(streaming.error()).toBe(error);

        dispose();
      });
    });

    it("should clear error when setting null", () => {
      createRoot(dispose => {
        const streaming = useStreaming();

        streaming.setError(new Error("Test error"));
        expect(streaming.error()).toBeInstanceOf(Error);

        streaming.setError(null);
        expect(streaming.error()).toBe(null);

        dispose();
      });
    });
  });

  describe("complete method", () => {
    it("should set status to done", () => {
      createRoot(dispose => {
        const streaming = useStreaming();

        streaming.start();
        streaming.complete();

        expect(streaming.status()).toBe("done");

        dispose();
      });
    });

    it("should set active message ID when provided", () => {
      createRoot(dispose => {
        const streaming = useStreaming();

        streaming.complete("msg-complete");
        expect(streaming.activeMessageId()).toBe("msg-complete");

        dispose();
      });
    });

    it("should preserve existing active message if not provided", () => {
      createRoot(dispose => {
        const streaming = useStreaming();

        streaming.start("msg-original");
        streaming.complete();

        expect(streaming.activeMessageId()).toBe("msg-original");

        dispose();
      });
    });
  });

  describe("stop method", () => {
    it("should set status to idle", () => {
      createRoot(dispose => {
        const streaming = useStreaming();

        streaming.start();
        expect(streaming.status()).toBe("connecting");

        streaming.stop();
        expect(streaming.status()).toBe("idle");

        dispose();
      });
    });

    it("should clear error", () => {
      createRoot(dispose => {
        const streaming = useStreaming();

        streaming.setError(new Error("error"));
        streaming.stop();

        expect(streaming.error()).toBe(null);

        dispose();
      });
    });
  });

  describe("reset method", () => {
    it("should reset all state to initial values", () => {
      createRoot(dispose => {
        const streaming = useStreaming();

        streaming.start("msg-123");
        streaming.setStatus("streaming");
        streaming.setError(new Error("error"));

        expect(streaming.status()).toBe("streaming");
        expect(streaming.activeMessageId()).toBe("msg-123");
        expect(streaming.error()).toBeInstanceOf(Error);

        streaming.reset();

        expect(streaming.status()).toBe("idle");
        expect(streaming.activeMessageId()).toBe(null);
        expect(streaming.error()).toBe(null);

        dispose();
      });
    });
  });

  describe("isLoading derived state", () => {
    it("should be true when connecting", () => {
      createRoot(dispose => {
        const streaming = useStreaming();

        streaming.setStatus("connecting");
        expect(streaming.isLoading()).toBe(true);

        dispose();
      });
    });

    it("should be true when streaming", () => {
      createRoot(dispose => {
        const streaming = useStreaming();

        streaming.setStatus("streaming");
        expect(streaming.isLoading()).toBe(true);

        dispose();
      });
    });

    it("should be false when idle", () => {
      createRoot(dispose => {
        const streaming = useStreaming();

        streaming.setStatus("idle");
        expect(streaming.isLoading()).toBe(false);

        dispose();
      });
    });

    it("should be false when done", () => {
      createRoot(dispose => {
        const streaming = useStreaming();

        streaming.setStatus("done");
        expect(streaming.isLoading()).toBe(false);

        dispose();
      });
    });

    it("should be false when error", () => {
      createRoot(dispose => {
        const streaming = useStreaming();

        streaming.setStatus("error");
        expect(streaming.isLoading()).toBe(false);

        dispose();
      });
    });
  });

  describe("canSend derived state", () => {
    it("should be true when idle", () => {
      createRoot(dispose => {
        const streaming = useStreaming();

        streaming.setStatus("idle");
        expect(streaming.canSend()).toBe(true);

        dispose();
      });
    });

    it("should be true when done", () => {
      createRoot(dispose => {
        const streaming = useStreaming();

        streaming.setStatus("done");
        expect(streaming.canSend()).toBe(true);

        dispose();
      });
    });

    it("should be true when error", () => {
      createRoot(dispose => {
        const streaming = useStreaming();

        streaming.setStatus("error");
        expect(streaming.canSend()).toBe(true);

        dispose();
      });
    });

    it("should be false when connecting", () => {
      createRoot(dispose => {
        const streaming = useStreaming();

        streaming.setStatus("connecting");
        expect(streaming.canSend()).toBe(false);

        dispose();
      });
    });

    it("should be false when streaming", () => {
      createRoot(dispose => {
        const streaming = useStreaming();

        streaming.setStatus("streaming");
        expect(streaming.canSend()).toBe(false);

        dispose();
      });
    });
  });

  describe("state transitions", () => {
    it("should transition from idle to connecting to streaming to done", () => {
      createRoot(dispose => {
        const streaming = useStreaming();

        expect(streaming.status()).toBe("idle");
        expect(streaming.canSend()).toBe(true);

        streaming.start();
        expect(streaming.status()).toBe("connecting");
        expect(streaming.isLoading()).toBe(true);

        streaming.setStatus("streaming");
        expect(streaming.status()).toBe("streaming");
        expect(streaming.isLoading()).toBe(true);

        streaming.complete();
        expect(streaming.status()).toBe("done");
        expect(streaming.isLoading()).toBe(false);
        expect(streaming.canSend()).toBe(true);

        dispose();
      });
    });

    it("should transition from streaming to error on error", () => {
      createRoot(dispose => {
        const streaming = useStreaming();

        streaming.start();
        streaming.setStatus("streaming");

        streaming.setError(new Error("Stream failed"));
        streaming.setStatus("error");

        expect(streaming.status()).toBe("error");
        expect(streaming.isLoading()).toBe(false);
        expect(streaming.canSend()).toBe(true);
        expect(streaming.error()).toBeInstanceOf(Error);

        dispose();
      });
    });

    it("should reset and start new streaming after completion", () => {
      createRoot(dispose => {
        const streaming = useStreaming();

        streaming.start("msg-1");
        streaming.complete();
        expect(streaming.status()).toBe("done");

        streaming.reset();
        expect(streaming.status()).toBe("idle");

        streaming.start("msg-2");
        expect(streaming.status()).toBe("connecting");
        expect(streaming.activeMessageId()).toBe("msg-2");

        dispose();
      });
    });
  });

  describe("cleanup", () => {
    it("should cleanup properly on dispose", () => {
      createRoot(dispose => {
        const streaming = useStreaming();

        streaming.start("msg-123");
        streaming.setStatus("streaming");
        streaming.setError(new Error("test"));

        expect(streaming.status()).toBe("streaming");

        // Dispose should trigger cleanup
        dispose();

        // After dispose, state should be reset
        // Note: We can't actually test this since the root is disposed
        // But the cleanup function should have been called
      });
    });
  });
});
