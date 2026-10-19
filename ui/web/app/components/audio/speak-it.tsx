import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import type { AudioActionData } from "~/routes/app.api.audio";
import type { AudioOverview, SpeechEngineOption } from "~/lib/audio-types";
import { providerName } from "~/lib/provider-names";
import { loadVoices, pickVoice, readPrefs, speak, speechSupported, type Speaking } from "~/lib/speech";

const ACTION = "/app/api/audio";

/** Each provider's own price page; a learner's own speech server has none. */
const PRICE_PAGES: Record<string, string> = {
  openai: "https://openai.com/api/pricing/",
};

const BROWSER = "browser";

function optionValue(o: SpeechEngineOption): string {
  return o.engine === "byok" ? `byok:${o.connection_id ?? ""}` : o.engine;
}

/**
 * speak-it.tsx
 * The "Speak it" step of an audio overview (up-methods phase 22): one
 * hairline row per way to hear the script, each with what it costs, and only
 * the ways that have voices for the script's language. The server lists the
 * built-in Kokoro and the learner's speech keys (`engines`); the browser's own
 * voices are always the last row and run here, without the server.
 *
 * Nothing is chosen for the learner: Speak it stays disabled until a row is
 * picked, and a row the server says cannot start (today's built-in minutes
 * used up) shows its reason and cannot be picked.
 */
export function SpeakIt({ overview: o }: { overview: AudioOverview }) {
  const { t, i18n } = useTranslation("common");
  const fetcher = useFetcher<AudioActionData>();
  const [chosen, setChosen] = useState("");
  const engines = o.engines ?? [];
  const picked = engines.find((e) => optionValue(e) === chosen && e.usable);
  const busy = fetcher.state !== "idle";

  const title = (e: SpeechEngineOption) => {
    if (e.engine === "builtin") {
      const minutes = e.wait_minutes || e.speech_minutes;
      return minutes ? t("audioEngines.builtin", { minutes }) : t("audioEngines.builtinNoTime");
    }
    if (e.provider === "openai_compat") return t("audioEngines.yourServer");
    return t("audioEngines.yourKey", { provider: providerName(t, e.provider) });
  };

  const detail = (e: SpeechEngineOption): string[] => {
    const voices = { host: e.voices.host, expert: e.voices.expert };
    if (e.engine === "builtin") {
      const lines = [
        t("audioEngines.builtinBody", voices),
        t("audioEngines.builtinMinutes", { need: e.need_minutes ?? 0, daily: e.daily_minutes ?? 0, used: e.used_minutes ?? 0 }),
      ];
      if (e.queue_ahead) lines.push(t("audioEngines.builtinLine", { count: e.queue_ahead }));
      return lines;
    }
    return [
      t("audioEngines.keyBody", {
        ...voices,
        chars: e.chars.toLocaleString(i18n.language),
        provider: providerName(t, e.provider),
        model: e.model,
        minutes: Math.max(1, e.speech_minutes),
      }),
    ];
  };

  const speakIt = () => {
    if (!picked) return;
    const form: Record<string, string> = { intent: "speak", id: o.id, engine: picked.engine };
    if (picked.engine === "byok") form.connectionId = picked.connection_id ?? "";
    void fetcher.submit(form, { method: "post", action: ACTION });
  };

  const failed = fetcher.data && !fetcher.data.ok ? fetcher.data.error : null;

  return (
    <fieldset className="mt-3">
      <legend className="text-sm leading-prose">{t("audioEngines.lead")}</legend>
      {o.language === "vi" ? <p className="mt-1 text-sm text-muted-foreground">{t("audioEngines.noVietnamese")}</p> : null}
      <ul className="mt-3 border-t">
        {engines.map((e) => {
          const value = optionValue(e);
          const id = `lp-speak-${o.id}-${value.replace(/[^a-z0-9-]/gi, "-")}`;
          const price = PRICE_PAGES[e.provider];
          return (
            <li key={value} className="border-b py-3">
              <div className="flex items-start gap-3">
                <input
                  id={id}
                  type="radio"
                  name={`speak-${o.id}`}
                  value={value}
                  checked={chosen === value}
                  disabled={!e.usable}
                  onChange={() => setChosen(value)}
                  aria-describedby={`${id}-detail`}
                  className="mt-1.5 size-4 shrink-0"
                />
                <div className="min-w-0">
                  <label htmlFor={id} className="text-sm font-medium">
                    {title(e)}
                    {e.name && e.engine === "byok" ? <span className="ml-2 font-normal text-muted-foreground">{e.name}</span> : null}
                  </label>
                  <div id={`${id}-detail`} className="mt-1 space-y-0.5 text-sm leading-snug text-muted-foreground">
                    {detail(e).map((line) => (
                      <p key={line}>{line}</p>
                    ))}
                    {!e.usable && e.reason ? <p className="text-warning">{e.reason}</p> : null}
                  </div>
                  {price ? (
                    <a
                      href={price}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="mt-1 inline-flex min-h-11 items-center text-sm text-primary underline-offset-2 hover:underline"
                    >
                      {t("audioEngines.prices", { provider: providerName(t, e.provider) })}
                    </a>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
        <li className="border-b py-3">
          <div className="flex items-start gap-3">
            <input
              id={`lp-speak-${o.id}-${BROWSER}`}
              type="radio"
              name={`speak-${o.id}`}
              value={BROWSER}
              checked={chosen === BROWSER}
              onChange={() => setChosen(BROWSER)}
              className="mt-1.5 size-4 shrink-0"
            />
            <div className="min-w-0">
              <label htmlFor={`lp-speak-${o.id}-${BROWSER}`} className="text-sm font-medium">
                {t("audioEngines.browser")}
              </label>
              <p className="mt-1 text-sm leading-snug text-muted-foreground">{t("audioEngines.browserBody")}</p>
              {chosen === BROWSER ? <BrowserReader overview={o} /> : null}
            </div>
          </div>
        </li>
      </ul>
      {chosen !== BROWSER ? (
        <>
          <Button type="button" size="sm" className="mt-3" disabled={busy || !picked} onClick={speakIt}>
            {t("audio.speak")}
          </Button>
          {!picked ? <p className="mt-1 text-xs text-muted-foreground">{t("audioEngines.chooseFirst")}</p> : null}
        </>
      ) : null}
      {failed ? (
        <p role="alert" className="mt-1 text-sm text-destructive">
          {failed}
        </p>
      ) : null}
    </fieldset>
  );
}

/** Reads the whole script aloud with the browser's own voice for its language. */
function BrowserReader({ overview: o }: { overview: AudioOverview }) {
  const { t } = useTranslation("common");
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null | undefined>(undefined);
  const [playing, setPlaying] = useState(false);
  const reading = useRef<Speaking | null>(null);
  const supported = speechSupported();

  useEffect(() => {
    if (!supported) return;
    let live = true;
    void loadVoices().then((list) => {
      if (live) setVoice(pickVoice(list, o.language, readPrefs().voices[o.language]));
    });
    return () => {
      live = false;
      reading.current?.stop();
    };
  }, [supported, o.language]);

  if (!supported) return <p className="mt-1 text-sm text-warning">{t("audioEngines.browserUnsupported")}</p>;
  if (voice === null) return <p className="mt-1 text-sm text-warning">{t("audioEngines.browserNoVoice")}</p>;

  const text = (o.script?.segments ?? []).map((s) => s.text).join(" ");
  const toggle = () => {
    if (playing) {
      reading.current?.stop();
      reading.current = null;
      setPlaying(false);
      return;
    }
    setPlaying(true);
    reading.current = speak(text, {
      voice: voice ?? null,
      lang: o.language,
      rate: readPrefs().rate,
      onEnd: () => setPlaying(false),
      onError: () => setPlaying(false),
    });
  };
  return (
    <Button type="button" size="sm" variant="outline" className="mt-2" disabled={voice === undefined} onClick={toggle}>
      {playing ? t("audioEngines.browserStop") : t("audioEngines.browserRead")}
    </Button>
  );
}

/** The finished audio's label: which engine and voices spoke it. */
export function SpokenBy({ overview: o }: { overview: AudioOverview }) {
  const { t } = useTranslation("common");
  if (!o.tts_engine || !o.tts_voices) return null;
  const voices = { host: o.tts_voices.host, expert: o.tts_voices.expert };
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      {o.tts_engine === "builtin"
        ? t("audioEngines.spokenBuiltin", voices)
        : t("audioEngines.spokenKey", { ...voices, provider: providerName(t, o.tts_engine), model: o.tts_model ?? "" })}
    </p>
  );
}
