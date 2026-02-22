/**
 * DOM Assertions
 *
 * Custom assertions for testing visible DOM behavior in integration tests.
 * Part of Batch 5: WS7 Testing Overhaul
 *
 * @package @sakti-code/desktop/tests
 */

import type { EventOrderingFixture } from "@sakti-code/shared";

/**
 * Assert that a user message is visible in the DOM
 */
export function expectUserMessageVisible(container: HTMLElement, content?: string): void {
  const userMessages = container.querySelectorAll('[data-role="user"]');
  expect(userMessages.length).toBeGreaterThan(0);

  if (content) {
    const found = Array.from(userMessages).some(el => el.textContent?.includes(content));
    expect(found).toBe(true);
  }
}

/**
 * Assert that assistant content is visible in the DOM
 */
export function expectAssistantContentVisible(container: HTMLElement, content?: string): void {
  const assistantMessages = container.querySelectorAll('[data-role="assistant"]');
  expect(assistantMessages.length).toBeGreaterThan(0);

  if (content) {
    const found = Array.from(assistantMessages).some(el => el.textContent?.includes(content));
    expect(found).toBe(true);
  }
}

/**
 * Assert that typing indicator is visible
 */
export function expectTypingIndicatorVisible(container: HTMLElement): void {
  const typingIndicator = container.querySelector('[data-testid="typing-indicator"]');
  expect(typingIndicator).toBeTruthy();
  expect(typingIndicator?.getAttribute("data-visible")).toBe("true");
}

/**
 * Assert that typing indicator is NOT visible
 */
export function expectTypingIndicatorHidden(container: HTMLElement): void {
  const typingIndicator = container.querySelector('[data-testid="typing-indicator"]');
  if (typingIndicator) {
    expect(typingIndicator.getAttribute("data-visible")).toBe("false");
  }
}

/**
 * Assert that error state is visible
 */
export function expectErrorStateVisible(container: HTMLElement, message?: string): void {
  const errorElement = container.querySelector('[data-testid="error-state"]');
  expect(errorElement).toBeTruthy();

  if (message) {
    expect(errorElement?.textContent).toContain(message);
  }
}

/**
 * Assert fixture expected behavior against DOM
 */
export function assertFixtureBehavior(container: HTMLElement, fixture: EventOrderingFixture): void {
  const { expectedBehavior } = fixture;

  if (expectedBehavior.userMessageVisible) {
    expectUserMessageVisible(container);
  }

  if (expectedBehavior.assistantContentVisible) {
    expectAssistantContentVisible(container);
  }

  if (expectedBehavior.typingIndicatorVisible) {
    expectTypingIndicatorVisible(container);
  } else {
    expectTypingIndicatorHidden(container);
  }

  if (expectedBehavior.hasError) {
    expectErrorStateVisible(container);
  }
}

/**
 * Wait for element to appear in DOM
 */
export async function waitForElement(
  container: HTMLElement,
  selector: string,
  timeoutMs = 5000
): Promise<Element> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const element = container.querySelector(selector);
    if (element) {
      return element;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  throw new Error(`Timeout waiting for element: ${selector}`);
}

/**
 * Wait for text to appear in DOM
 */
export async function waitForText(
  container: HTMLElement,
  text: string,
  timeoutMs = 5000
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (container.textContent?.includes(text)) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  throw new Error(`Timeout waiting for text: ${text}`);
}

/**
 * Flush all pending promises
 */
export async function flushPromises(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Flush SolidJS reactive updates
 */
export async function flushReactive(): Promise<void> {
  // SolidJS updates are synchronous, but we need to wait for effects
  await flushPromises();
  await flushPromises();
}
