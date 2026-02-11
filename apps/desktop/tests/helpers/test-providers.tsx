/**
 * Test Helpers for Desktop App
 *
 * Provides utility functions and providers for testing
 * with proper context isolation.
 *
 * Phase 0: Setup & Test Infrastructure
 */

import { StoreProvider } from "@renderer/presentation/providers/store-provider";
import type { JSX } from "solid-js";
import { render } from "solid-js/web";
import { vi } from "vitest";
import { MessageProvider } from "../../src/presentation/contexts/message-context";
import { PartProvider } from "../../src/presentation/contexts/part-context";
import { SessionProvider } from "../../src/presentation/contexts/session-context";
import { UIProvider } from "../../src/presentation/contexts/ui-context";

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
  const container = document.createElement("div");
  document.body.appendChild(container);

  const dispose = render(() => <TestProviders>{ui()}</TestProviders>, container);

  return {
    container,
    dispose: () => {
      dispose();
      document.body.removeChild(container);
    },
  };
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
