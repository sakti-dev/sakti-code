/**
 * LLM test helpers.
 *
 * The original pi-ai faux-provider system intercepted pi-ai's internal stream
 * functions. Since the agent now uses `@sakti-code/llm` (which routes through
 * `@ai-sdk` factories), those hooks are gone. These helpers remain as env-var
 * management + lightweight response shapes so test files that import them keep
 * compiling. Tests that actually need to mock LLM output should use
 * `vi.mock("@sakti-code/llm")` to mock `stream` / `complete` directly.
 */

/** A canned response step (assistant text or tool call). */
export interface FauxResponseStep {
  text?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
}

/** Opaque registration handle (no-op in the post-pi-ai world). */
export interface FauxProviderRegistration {
  setResponses(_responses: FauxResponseStep[]): void;
  unregister(): void;
}

/** Build a faux assistant message response step. */
export function fauxAssistantMessage(
  text: string,
  _options?: {
    stopReason?: string;
    errorMessage?: string;
    usage?: Record<string, number>;
  },
): FauxResponseStep {
  return { text };
}

/** Build a faux tool-call response step. */
export function fauxToolCall(
  name: string,
  arguments_: Record<string, unknown>,
  options: { id?: string } = {},
): FauxResponseStep {
  return {
    toolCalls: [
      {
        id: options.id ?? `call-${Date.now()}`,
        name,
        arguments: arguments_,
      },
    ],
  };
}

/** No-op faux provider registration (env-var only). */
export function registerFauxProvider(): FauxProviderRegistration {
  return {
    setResponses() {},
    unregister() {},
  };
}

const activeRegistrations: FauxProviderRegistration[] = [];

/**
 * Set up a faux LLM environment for a test. Sets `OPENAI_API_KEY=test-key`
 * so resolver paths that check for an env key succeed. The faux registration
 * is a no-op — tests that need real LLM mocking should use `vi.mock`.
 */
export function useFauxLlm(
  responses?: FauxResponseStep[],
  _options: { api?: string } = {},
): FauxProviderRegistration {
  process.env.OPENAI_API_KEY = "test-key";
  const registration = registerFauxProvider();
  activeRegistrations.push(registration);
  if (responses && responses.length > 0) {
    registration.setResponses(responses);
  }
  return registration;
}

/** Unregister all faux providers and clear the test API key. */
export function teardownFauxLlm(): void {
  while (activeRegistrations.length > 0) {
    const reg = activeRegistrations.pop();
    reg?.unregister();
  }
  delete process.env.OPENAI_API_KEY;
}
