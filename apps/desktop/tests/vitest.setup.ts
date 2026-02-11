/**
 * Vitest setup for desktop app tests
 *
 * Provides global mocks for browser APIs not available in test environment
 */

// Mock Web Speech API
global.SpeechRecognition = class SpeechRecognition {
  continuous = true;
  interimResults = true;
  lang = "en-US";
  maxAlternatives = 1;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onend: ((event: unknown) => void) | null = null;
  onstart: ((event: unknown) => void) | null = null;

  start() {}
  stop() {}
  abort() {}
} as never;

global.SpeechGrammarList = class SpeechGrammarList {
  grammars: unknown[] = [];
  addFromString() {}
  addFromURI() {}
} as never;

global.SpeechRecognitionEvent = class SpeechRecognitionEvent {
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
  type: string;
  resultIndex: number;
  results: unknown[];
} as unknown as typeof globalThis.SpeechRecognitionEvent;
