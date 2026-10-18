/**
 * speech-fake.ts
 * A fake `speechSynthesis` for tests: it records every utterance, and plays
 * the queue on demand so a test can step through sentences.
 */
export type FakeVoice = Pick<SpeechSynthesisVoice, "name" | "lang" | "localService" | "voiceURI" | "default">;

export function voice(name: string, lang: string, localService = true): SpeechSynthesisVoice {
  return { name, lang, localService, voiceURI: `${name}-${lang}`, default: false } as SpeechSynthesisVoice;
}

export class FakeUtterance {
  text: string;
  lang = "";
  voice: SpeechSynthesisVoice | null = null;
  rate = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

export class FakeSynth {
  voices: SpeechSynthesisVoice[];
  queue: FakeUtterance[] = [];
  spoken: FakeUtterance[] = [];
  cancels = 0;
  constructor(voices: SpeechSynthesisVoice[]) {
    this.voices = voices;
  }
  getVoices() {
    return this.voices;
  }
  speak(u: FakeUtterance) {
    this.queue.push(u);
  }
  cancel() {
    this.cancels++;
    this.queue = [];
  }
  addEventListener() {}
  removeEventListener() {}
  /** Plays the next queued utterance to its end. */
  step() {
    const u = this.queue.shift();
    if (!u) return false;
    u.onstart?.();
    this.spoken.push(u);
    u.onend?.();
    return true;
  }
}

/** Installs the fake on window; returns it and a function that removes it. */
export function installFakeSpeech(voices: SpeechSynthesisVoice[]) {
  const fake = new FakeSynth(voices);
  Object.defineProperty(window, "speechSynthesis", { value: fake, configurable: true, writable: true });
  Object.defineProperty(window, "SpeechSynthesisUtterance", {
    value: FakeUtterance,
    configurable: true,
    writable: true,
  });
  (globalThis as Record<string, unknown>).SpeechSynthesisUtterance = FakeUtterance;
  return {
    fake,
    remove() {
      delete (window as unknown as Record<string, unknown>).speechSynthesis;
      delete (window as unknown as Record<string, unknown>).SpeechSynthesisUtterance;
      delete (globalThis as Record<string, unknown>).SpeechSynthesisUtterance;
    },
  };
}
