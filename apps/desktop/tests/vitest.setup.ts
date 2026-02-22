/**
 * Vitest setup for desktop app tests
 *
 * Provides global mocks for browser APIs not available in test environment
 */

// Mock Web Speech API with explicit types
class MockSpeechRecognition implements SpeechRecognition {
  continuous = true;
  interimResults = true;
  lang = "en-US";
  maxAlternatives = 1;
  onresult: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onend: ((event: Event) => void) | null = null;
  onstart: ((event: Event) => void) | null = null;

  start() {}
  stop() {}
  abort() {}

  addEventListener() {}
  removeEventListener() {}
  dispatchEvent() {
    return false;
  }
}

Object.defineProperty(global, "SpeechRecognition", {
  value: MockSpeechRecognition,
  writable: true,
  configurable: true,
});

class MockSpeechGrammarList implements SpeechGrammarList {
  grammars: unknown[] = [];
  addFromString() {}
  addFromURI() {}
}

Object.defineProperty(global, "SpeechGrammarList", {
  value: MockSpeechGrammarList,
  writable: true,
  configurable: true,
});

class MockSpeechRecognitionEvent implements SpeechRecognitionEvent {
  readonly type: string;
  readonly resultIndex: number;
  readonly results: unknown[];

  constructor(
    type: string,
    eventInitDict: {
      resultIndex: number;
      results: unknown[];
    }
  ) {
    this.type = type;
    this.resultIndex = eventInitDict.resultIndex;
    this.results = eventInitDict.results;
  }

  bubbles = false;
  cancelBubble = false;
  cancelable = false;
  composed = false;
  currentTarget = null;
  defaultPrevented = false;
  eventPhase = 0;
  isTrusted = false;
  target = null;
  timeStamp = 0;
  srcElement = null;
  returnValue = true;
  readonly NONE = 0;
  readonly CAPTURING_PHASE = 1;
  readonly AT_TARGET = 2;
  readonly BUBBLING_PHASE = 3;
  composedPath() {
    return [];
  }
  initEvent() {}
  preventDefault() {}
  stopImmediatePropagation() {}
  stopPropagation() {}
}

Object.defineProperty(global, "SpeechRecognitionEvent", {
  value: MockSpeechRecognitionEvent,
  writable: true,
  configurable: true,
});
