import { describe, expect, it } from "vite-plus/test";
import type { ObservationalMemoryStorage } from "../observational-memory-storage.ts";

describe("ObservationalMemoryStorage contract", () => {
  it("includes pruneHistory method", () => {
    const stub = {
      getObservationalMemory: async () => null,
      getObservationalMemoryHistory: async () => [],
      initializeObservationalMemory: async () => ({}),
      insertObservationalMemoryRecord: async () => {},
      updateActiveObservations: async () => {},
      createReflectionGeneration: async () => ({}),
      setReflectingFlag: async () => {},
      setObservingFlag: async () => {},
      setBufferingObservationFlag: async () => {},
      setBufferingReflectionFlag: async () => {},
      clearObservationalMemory: async () => {},
      setPendingMessageTokens: async () => {},
      updateObservationalMemoryConfig: async () => {},
      updateBufferedObservations: async () => {},
      swapBufferedToActive: async () => ({}),
      updateBufferedReflection: async () => {},
      swapBufferedReflectionToActive: async () => ({}),
      pruneHistory: async () => {},
    } as unknown as ObservationalMemoryStorage;
    expect(typeof stub.pruneHistory).toBe("function");
  });
});
