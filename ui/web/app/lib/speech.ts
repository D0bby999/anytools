/**
 * speech.ts
 * Read-aloud through the browser's own `speechSynthesis`. Client-only.
 *
 * No provider, no key and no CSP change (research, external §3): the Web
 * Speech API fetches nothing from the page. What it CAN do is send the text to
 * the browser vendor — a voice with `localService === false` is "supplied by a
 * remote speech synthesizer service", which in desktop Chrome means Google. So
 * local voices are preferred, and the picker labels remote ones.
 *
 * Text is spoken one sentence per utterance. Chrome's network voices are
 * reported to stop long utterances after about fifteen seconds, and a sentence
 * is also the unit the reader highlights.
 */

/** The browser's synthesizer, or null (server render, jsdom, old browsers). */
export function synth(): SpeechSynthesis | null {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  return window.speechSynthesis ?? null;
}

export function speechSupported(): boolean {
  return synth() !== null && typeof window.SpeechSynthesisUtterance === "function";
}

/** The longest piece spoken as one utterance; a longer sentence is split. */
export const MAX_CHUNK = 220;

/**
 * Splits text into sentences for speaking: at terminal punctuation followed by
 * a space (or at a CJK full stop), then any sentence longer than MAX_CHUNK at
 * its last comma or space before the limit.
 */
export function splitSentences(text: string): string[] {
  const folded = text.replace(/\s+/g, " ").trim();
  if (!folded) return [];
  // Split AT boundaries rather than matching sentences, so no character can
  // fall between two matches: "3.14" has no space after its point and stays.
  const sentences = folded.split(/(?<=[.!?…]["'”’)\]]*)\s+|(?<=[。！？])/).filter(Boolean);
  const out: string[] = [];
  for (const raw of sentences) {
    let s = raw.trim();
    while (s.length > MAX_CHUNK) {
      const head = s.slice(0, MAX_CHUNK);
      const cut = Math.max(head.lastIndexOf(", "), head.lastIndexOf("; "));
      const at = cut > MAX_CHUNK / 3 ? cut + 1 : head.lastIndexOf(" ") > 0 ? head.lastIndexOf(" ") : MAX_CHUNK;
      out.push(s.slice(0, at).trim());
      s = s.slice(at).trim();
    }
    if (s) out.push(s);
  }
  return out;
}

/**
 * A model's Markdown answer as plain text to speak: code, markup, citation
 * markers and LaTeX removed. Formulas are dropped, not verbalised — reading
 * `\frac{a}{b}` aloud letter by letter helps nobody, and doing it properly is
 * a project of its own.
 */
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/\\\[[\s\S]*?\\\]/g, " ")
    .replace(/\\\([\s\S]*?\\\)/g, " ")
    .replace(/(^|[^\\$])\$[^$\n]+\$/g, "$1 ")
    .replace(/\[\[cite:[^\]]*\]\]/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/^\s*\|?[\s:|-]*-{3,}[\s:|-]*$/gm, " ")
    .replace(/\|/g, " ")
    .replace(/(\*\*|__|\*|~~)(?=\S)|(?<=\S)(\*\*|__|\*|~~)/g, "")
    .replace(/(^|\s)_(\S[^_]*\S|\S)_(?=\s|[.,;:!?]|$)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The language of a passage, by script, as a BCP 47 primary tag. The same
 * rule as the server's vocab.DetectLang: Vietnamese is told from other Latin
 * text by the letters only it uses.
 */
export function detectLang(text: string): string {
  let latin = 0,
    vi = 0,
    han = 0,
    kana = 0,
    hangul = 0,
    cyr = 0,
    thai = 0;
  for (const ch of text.normalize("NFC")) {
    if (/[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(ch)) {
      vi++;
      latin++;
    } else if (/[\u3040-\u30ff]/.test(ch)) kana++;
    else if (/\p{Script=Han}/u.test(ch)) han++;
    else if (/\p{Script=Hangul}/u.test(ch)) hangul++;
    else if (/\p{Script=Cyrillic}/u.test(ch)) cyr++;
    else if (/\p{Script=Thai}/u.test(ch)) thai++;
    else if (/\p{Script=Latin}/u.test(ch)) latin++;
  }
  if (kana > 0 && kana + han > latin) return "ja";
  if (han > latin) return "zh";
  if (hangul > latin) return "ko";
  if (cyr > latin) return "ru";
  if (thai > latin) return "th";
  if (latin > 0 && vi * 20 >= latin) return "vi";
  return "en";
}

const primary = (tag: string) => tag.toLowerCase().split(/[-_]/)[0] ?? "";

/** The voices that speak `lang`, local ones first, then by name. */
export function voicesFor(voices: readonly SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice[] {
  const want = primary(lang);
  return voices
    .filter((v) => primary(v.lang) === want)
    .sort((a, b) => Number(b.localService) - Number(a.localService) || a.name.localeCompare(b.name));
}

/**
 * The voice to read `lang` with: the one the learner chose for that language
 * if it still exists, else the first local voice for it, else a remote one,
 * else null — and null is said plainly, never papered over with a voice that
 * reads Vietnamese in an English accent.
 */
export function pickVoice(
  voices: readonly SpeechSynthesisVoice[],
  lang: string,
  preferredURI?: string,
): SpeechSynthesisVoice | null {
  const candidates = voicesFor(voices, lang);
  if (preferredURI) {
    const chosen = voices.find((v) => v.voiceURI === preferredURI);
    if (chosen) return chosen;
  }
  return candidates[0] ?? null;
}

/** Voices the browser has loaded. Chrome fills the list asynchronously. */
export function loadVoices(timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  const s = synth();
  if (!s) return Promise.resolve([]);
  const now = s.getVoices();
  if (now.length > 0) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      s.removeEventListener?.("voiceschanged", done);
      resolve(s.getVoices());
    };
    s.addEventListener?.("voiceschanged", done);
    setTimeout(done, timeoutMs);
  });
}

// ─────────────────────────────────────────────────────────── preferences

export type SpeechPrefs = { rate: number; voices: Record<string, string> };

const PREFS_KEY = "lp.speech";
export const DEFAULT_RATE = 1;

export function readPrefs(): SpeechPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<SpeechPrefs>) : {};
    const rate = typeof parsed.rate === "number" && parsed.rate >= 0.5 && parsed.rate <= 2 ? parsed.rate : DEFAULT_RATE;
    const voices = parsed.voices && typeof parsed.voices === "object" ? parsed.voices : {};
    return { rate, voices };
  } catch {
    return { rate: DEFAULT_RATE, voices: {} };
  }
}

export function writePrefs(prefs: SpeechPrefs): void {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode or a full store: the choice simply is not remembered.
  }
}

// ──────────────────────────────────────────────────────────────── speaking

export type SpeakOptions = {
  voice: SpeechSynthesisVoice | null;
  lang: string;
  rate: number;
  /** Called as each sentence starts, with its index in `sentences`. */
  onSentence?: (index: number) => void;
  onEnd?: () => void;
  onError?: (error: string) => void;
  /**
   * Who is speaking, announced with SPEECH_START_EVENT. The event fires
   * inside speak(), before the caller holds the returned id, so a reader
   * recognises its own announcement by this token rather than by the id.
   */
  owner?: object;
};

export type Speaking = { id: number; sentences: string[]; stop: () => void };

/**
 * The window event every reading announces as it starts. speak() cancels the
 * synthesizer's queue, which silences any other reader without telling it; a
 * reader listening for this event knows it was silenced and resets itself.
 */
export const SPEECH_START_EVENT = "lp:speech-start";
let nextSpeakingID = 1;

/**
 * Speaks `text` sentence by sentence. Anything already speaking is cancelled
 * first, so two Listen buttons never talk over each other. `stop()` cancels
 * the queue; onEnd is not called for a stopped reading.
 */
export function speak(text: string, opts: SpeakOptions): Speaking {
  const s = synth();
  const sentences = splitSentences(text);
  const id = nextSpeakingID++;
  if (!s || sentences.length === 0) {
    opts.onEnd?.();
    return { id, sentences, stop: () => {} };
  }
  s.cancel();
  window.dispatchEvent(new CustomEvent<object | number>(SPEECH_START_EVENT, { detail: opts.owner ?? id }));
  let stopped = false;
  sentences.forEach((sentence, index) => {
    const u = new SpeechSynthesisUtterance(sentence);
    u.lang = opts.voice?.lang ?? opts.lang;
    if (opts.voice) u.voice = opts.voice;
    u.rate = opts.rate;
    u.onstart = () => {
      if (!stopped) opts.onSentence?.(index);
    };
    if (index === sentences.length - 1) {
      u.onend = () => {
        if (!stopped) opts.onEnd?.();
      };
    }
    u.onerror = (event) => {
      // "interrupted" and "canceled" are what stop() itself causes.
      if (stopped || event.error === "interrupted" || event.error === "canceled") return;
      stopped = true;
      s.cancel();
      opts.onError?.(event.error);
    };
    s.speak(u);
  });
  return {
    id,
    sentences,
    stop: () => {
      stopped = true;
      s.cancel();
    },
  };
}
