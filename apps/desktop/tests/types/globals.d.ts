export {};

declare global {
  interface SpeechRecognition extends EventTarget {
    continuous: boolean;
    interimResults: boolean;
    lang: string;
    maxAlternatives: number;
    onresult: ((event: Event) => void) | null;
    onerror: ((event: Event) => void) | null;
    onend: ((event: Event) => void) | null;
    onstart: ((event: Event) => void) | null;
    start(): void;
    stop(): void;
    abort(): void;
  }

  interface SpeechGrammarList {
    grammars: unknown[];
    addFromString(): void;
    addFromURI(): void;
  }

  interface SpeechRecognitionEvent extends Event {
    resultIndex: number;
    results: unknown[];
  }

  interface Window {
    SpeechRecognition?: SpeechRecognition;
    SpeechGrammarList?: SpeechGrammarList;
    SpeechRecognitionEvent?: SpeechRecognitionEvent;
  }

  var SpeechRecognition: SpeechRecognition;
  var SpeechGrammarList: SpeechGrammarList;
  var SpeechRecognitionEvent: SpeechRecognitionEvent;
}
