import {
  type FauxProviderRegistration,
  type FauxResponseStep,
  fauxAssistantMessage,
  fauxToolCall,
  registerFauxProvider,
} from "@earendil-works/pi-ai";

export type { FauxProviderRegistration, FauxResponseStep };
export { fauxAssistantMessage, fauxToolCall, registerFauxProvider };

const activeRegistrations: FauxProviderRegistration[] = [];

/**
 * Register a faux LLM provider for the test. Sets `OPENAI_API_KEY=test-key`
 * so `getEnvApiKey("openai")` resolves, registers a faux provider that takes
 * over the `openai-responses` api (the api `gpt-4` and other OpenAI models
 * use in current pi-ai — intercepting both `streamSimple` and `completeSimple`),
 * and queues optional `responses` for the next calls.
 *
 * Pair with `teardownFauxLlm()` in `afterEach`.
 *
 * Pass a different `api` to override a non-OpenAI provider (e.g.
 * `"anthropic-messages"`).
 */
export function useFauxLlm(
  responses?: FauxResponseStep[],
  options: { api?: string } = {}
): FauxProviderRegistration {
  process.env.OPENAI_API_KEY = "test-key";
  const api = options.api ?? "openai-responses";
  const registration = registerFauxProvider({ api });
  activeRegistrations.push(registration);
  if (responses && responses.length > 0) {
    registration.setResponses(responses);
  }
  return registration;
}

/** Unregister all faux providers from this test and clear the test API key. */
export function teardownFauxLlm(): void {
  while (activeRegistrations.length > 0) {
    const reg = activeRegistrations.pop();
    reg?.unregister();
  }
  delete process.env.OPENAI_API_KEY;
}
