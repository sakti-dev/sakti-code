/**
 * Test Server Fixture for Desktop Integration Tests
 *
 * Creates a real Hono server with all routes for end-to-end testing.
 * Uses the actual server implementation from @sakti-code/server.
 */

import { serve } from "@hono/node-server";
import type serverApp from "@sakti-code/server";
import type { AddressInfo } from "node:net";

type ServerApp = typeof serverApp;

export interface TestServer {
  /** Hono app instance */
  app: ServerApp;
  /** HTTP server instance */
  server: Awaited<ReturnType<typeof serve>>;
  /** Server port number */
  port: number;
  /** Full server URL */
  url: string;
  /** Auth token for requests */
  token: string;
  /** Cleanup function - call after each test */
  cleanup: () => Promise<void>;
  /** Helper to create authenticated request */
  request: (path: string, init?: RequestInit) => Promise<Response>;
}

/**
 * Create a test server with full route stack
 *
 * @example
 * ```typescript
 * const server = await createTestServer();
 *
 * // Make API request
 * const response = await server.request('/api/chat', {
 *   method: 'POST',
 *   body: JSON.stringify({ messages: [...] }),
 * });
 *
 * // Cleanup
 * await server.cleanup();
 * ```
 */
export async function createTestServer(): Promise<TestServer> {
  // Import server components dynamically to avoid loading issues
  const { default: app } = await import("@sakti-code/server");
  const { getServerToken } = await import("@sakti-code/server");

  // Start server on random port
  const server = await serve({
    fetch: app.fetch,
    port: 0, // Random available port
  });

  const address = server.address() as AddressInfo;
  const port = address.port;
  const url = `http://127.0.0.1:${port}`;
  const token = getServerToken();

  // Return server interface
  return {
    app,
    server,
    port,
    url,
    token,

    cleanup: async () => {
      return new Promise<void>(resolve => {
        server.close(() => {
          resolve();
        });
      });
    },

    request: async (path: string, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Basic ${Buffer.from(`admin:${token}`).toString("base64")}`);

      return fetch(`${url}${path}`, {
        ...init,
        headers,
      });
    },
  };
}

/**
 * Helper to wait for SSE event
 */
export function waitForEvent(
  eventSource: EventSource,
  eventType: string,
  timeout = 5000
): Promise<MessageEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${eventType}`));
    }, timeout);

    const handler = (event: MessageEvent) => {
      clearTimeout(timer);
      eventSource.removeEventListener(eventType, handler);
      resolve(event);
    };

    eventSource.addEventListener(eventType, handler);
  });
}

/**
 * Helper to collect all events of a type
 */
export function collectEvents(
  eventSource: EventSource,
  eventType: string,
  count: number,
  timeout = 10000
): Promise<MessageEvent[]> {
  return new Promise((resolve, reject) => {
    const events: MessageEvent[] = [];
    const timer = setTimeout(() => {
      reject(new Error(`Timeout collecting ${count} events, got ${events.length}`));
    }, timeout);

    const handler = (event: MessageEvent) => {
      events.push(event);
      if (events.length >= count) {
        clearTimeout(timer);
        eventSource.removeEventListener(eventType, handler);
        resolve(events);
      }
    };

    eventSource.addEventListener(eventType, handler);
  });
}
