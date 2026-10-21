import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Play, Square, X } from "lucide-react";
import {
  DEFAULT_RATE,
  SPEECH_START_EVENT,
  detectLang,
  loadVoices,
  pickVoice,
  readPrefs,
  speak,
  speechSupported,
  splitSentences,
  voicesFor,
  writePrefs,
  type Speaking,
} from "~/lib/speech";
import { Button } from "~/components/ui/button";

/**
 * The reader's voice: a panel pinned where the selection toolbar sits, reading
 * `text` sentence by sentence with the sentence being read highlighted.
 *
 * The language is detected from the text (or given); the voice is the one the
 * learner last chose for that language, else a local one. Remote voices are
 * labelled, because choosing one sends the text to the browser's maker. With
 * no voice for the language the panel says so and lists every other voice,
 * rather than silently reading Vietnamese with an English one.
 */
export function ReadAloudBar({ text, lang: givenLang, onClose }: { text: string; lang?: string; onClose: () => void }) {
  const { t } = useTranslation("vocab");
  const lang = givenLang || detectLang(text);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[] | null>(null);
  const [voiceURI, setVoiceURI] = useState<string>("");
  const [rate, setRate] = useState(DEFAULT_RATE);
  const [current, setCurrent] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const reading = useRef<Speaking | null>(null);
  const me = useRef({});
  const sentences = splitSentences(text);

  useEffect(() => {
    let live = true;
    const prefs = readPrefs();
    setRate(prefs.rate);
    void loadVoices().then((list) => {
      if (!live) return;
      setVoices(list);
      setVoiceURI(pickVoice(list, lang, prefs.voices[lang])?.voiceURI ?? "");
    });
    return () => {
      live = false;
    };
  }, [lang]);

  const stop = useCallback(() => {
    reading.current?.stop();
    reading.current = null;
    setPlaying(false);
  }, []);

  const play = useCallback(
    (uri: string, speed: number) => {
      const voice = voices?.find((v) => v.voiceURI === uri) ?? null;
      if (!voice) return;
      setFailure(null);
      setPlaying(true);
      reading.current = speak(text, {
        voice,
        lang,
        rate: speed,
        owner: me.current,
        onSentence: setCurrent,
        onEnd: () => {
          setPlaying(false);
          setCurrent(-1);
        },
        onError: (error) => {
          setPlaying(false);
          setFailure(t("speech.failed", { error }));
        },
      });
    },
    [voices, text, lang, t],
  );

  // Start as soon as a voice is known; stop when the panel goes away.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !voiceURI || !voices) return;
    started.current = true;
    play(voiceURI, rate);
  }, [voiceURI, voices, rate, play]);
  useEffect(() => stop, [stop]);

  // Another reader started: this one was silenced by its cancel().
  useEffect(() => {
    const other = (event: Event) => {
      if ((event as CustomEvent<object | number>).detail !== me.current) {
        reading.current = null;
        setPlaying(false);
        setCurrent(-1);
      }
    };
    window.addEventListener(SPEECH_START_EVENT, other);
    return () => window.removeEventListener(SPEECH_START_EVENT, other);
  }, []);

  const remember = (uri: string, speed: number) => {
    const prefs = readPrefs();
    writePrefs({ rate: speed, voices: uri ? { ...prefs.voices, [lang]: uri } : prefs.voices });
  };

  const own = voices ? voicesFor(voices, lang) : [];
  const others = voices
    ? voices
        .filter((v) => !own.includes(v))
        .sort((a, b) => Number(b.localService) - Number(a.localService) || a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name))
    : [];
  const noVoice = voices !== null && own.length === 0;
  const label = (v: SpeechSynthesisVoice) =>
    `${v.name} (${v.lang}) · ${v.localService ? t("speech.local") : t("speech.remote")}`;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-popover flex justify-center px-4 lg:bottom-6">
      <section
        aria-labelledby="lp-read-aloud"
        className="pointer-events-auto w-full max-w-xl rounded-lg border bg-card p-3 shadow-sm"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 id="lp-read-aloud" className="lp-section">
            {t("speech.title")} <span className="font-mono">{lang}</span>
          </h2>
          <Button type="button" size="icon" variant="ghost" aria-label={t("speech.close")} onClick={onClose}>
            <X aria-hidden="true" />
          </Button>
        </div>

        {!speechSupported() ? (
          <p role="status" className="mt-2 text-sm text-muted-foreground">
            {t("speech.unsupported")}
          </p>
        ) : (
          <>
            {noVoice ? (
              <p role="status" className="mt-2 text-sm leading-prose">
                {t("speech.noVoice", { lang })}
              </p>
            ) : null}

            <ol aria-live="off" className="mt-2 max-h-32 overflow-y-auto text-sm leading-prose">
              {sentences.map((s, i) => (
                <li
                  key={`${i}-${s.slice(0, 12)}`}
                  aria-current={i === current ? "true" : undefined}
                  className={i === current ? "rounded-sm bg-primary-soft" : "text-muted-foreground"}
                >
                  {s}
                </li>
              ))}
            </ol>

            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted-foreground">
                {t("speech.voice")}
                <select
                  className="h-9 min-w-0 rounded-md border border-control-border bg-card px-2 text-sm text-foreground"
                  value={voiceURI}
                  onChange={(e) => {
                    stop();
                    setVoiceURI(e.target.value);
                    remember(e.target.value, rate);
                    if (e.target.value) play(e.target.value, rate);
                  }}
                >
                  {noVoice ? <option value="">–</option> : null}
                  {[...own, ...others].map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>
                      {label(v)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                {t("speech.rate")} <span className="font-mono">{rate.toFixed(1)}×</span>
                <input
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.1}
                  value={rate}
                  onChange={(e) => {
                    const speed = Number(e.target.value);
                    setRate(speed);
                    remember(voiceURI, speed);
                  }}
                  onPointerUp={() => {
                    if (playing) {
                      stop();
                      play(voiceURI, rate);
                    }
                  }}
                />
              </label>
              {playing ? (
                <Button type="button" size="sm" variant="outline" onClick={stop}>
                  <Square aria-hidden="true" />
                  {t("speech.stop")}
                </Button>
              ) : (
                <Button type="button" size="sm" disabled={!voiceURI} onClick={() => play(voiceURI, rate)}>
                  <Play aria-hidden="true" />
                  {t("speech.readAloud")}
                </Button>
              )}
            </div>
            <p className="mt-2 text-xs leading-snug text-muted-foreground">{t("speech.remoteNote")}</p>
            {failure ? (
              <p role="alert" className="mt-2 text-xs text-destructive">
                {failure}
              </p>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
