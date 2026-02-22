/**
 * Test Helpers for Desktop App
 *
 * Provides utility functions and providers for testing
 * with proper context isolation.
 *
 * Phase 0: Setup & Test Infrastructure
 */

import { MessageProvider } from "@/core/state/contexts/message-context";
import { PartProvider } from "@/core/state/contexts/part-context";
import { SessionProvider } from "@/core/state/contexts/session-context";
import { UIProvider } from "@/core/state/contexts/ui-context";
import { StoreProvider } from "@/core/state/providers/store-provider";
import { cleanup, render } from "@solidjs/testing-library";
import type { JSX } from "solid-js";
import { vi } from "vitest";

afterEach(cleanup);

/**
 * TestProviders - Wraps components with all necessary providers
 *
 * This ensures tests have proper context isolation without needing
 * to manually wrap each component.
 *
 * @example
 * ```tsx
 * function TestComponent() {
 *   const [messageState] = useMessageStore();
 *   return <div>{JSON.stringify(messageState)}</div>;
 * }
 *
 * renderWithProviders(<TestComponent />);
 * ```
 */
export function TestProviders(props: { children: JSX.Element }) {
  return (
    <StoreProvider>
      <MessageProvider>
        <PartProvider>
          <SessionProvider>
            <UIProvider>{props.children}</UIProvider>
          </SessionProvider>
        </PartProvider>
      </MessageProvider>
    </StoreProvider>
  );
}

/**
 * Render helper with providers
 */
export function renderWithProviders(ui: () => JSX.Element) {
  return render(() => <TestProviders>{ui()}</TestProviders>);
}

/**
 * Create mock store with initial data
 */
export function createMockStore<T>(initial: T) {
  return {
    state: initial,
    setState: vi.fn(),
  };
}

/**
 * Wait for async updates in SolidJS
 */
export async function waitFor(ms = 0) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Suppress console errors during tests
 */
export async function suppressConsoleErrors(fn: () => void | Promise<void>) {
  const originalError = console.error;
  const originalWarn = console.warn;

  console.error = vi.fn();
  console.warn = vi.fn();

  try {
    await fn();
  } finally {
    console.error = originalError;
    console.warn = originalWarn;
  }
}
