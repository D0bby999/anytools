import { useState } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import type { EngineOption, TranscribeEstimate } from "~/lib/kb-types";
import { providerName } from "~/lib/provider-names";
import type { TranscriptActionData } from "./needs-transcript";

/**
 * engine-picker.tsx
 * Who transcribes a video without captions (up-methods phase 21): the
 * server's own Whisper, the learner's Groq, OpenAI or own speech server key,
 * or their Gemini key reading the public URL. One hairline row per engine,
 * each saying what it costs before anything runs: time and today's minutes
 * for the built-in engine, minutes of audio billed for a speech key, tokens
 * for Gemini, with a link to the provider's prices.
 *
 * Nothing is chosen for the learner: Transcribe stays disabled until a row is
 * picked. A row the server says cannot start now (the day's built-in minutes
 * used up, an unknown length) is shown with its reason and cannot be picked.
 *
 * Up-methods phase 15: for an uploaded recording the same rows say that the
 * server hears the stored file (nothing is downloaded), Gemini's cost is
 * counted at its audio rate, and a file whose length could not be read says
 * "unknown length" and asks the learner to confirm before Transcribe works.
 */

/** Each provider's own price page; an OpenAI-compatible server has none. */
const PRICE_PAGES: Record<string, string> = {
  groq: "https://groq.com/pricing",
  openai: "https://openai.com/api/pricing/",
  gemini: "https://ai.google.dev/gemini-api/docs/pricing",
};

/** "Systran/faster-whisper-small" reads as "Whisper small" (stt.ModelLabel). */
export function whisperLabel(model: string): string {
  let m = model.slice(model.lastIndexOf("/") + 1).replace(/-ct2$/, "");
  const at = m.indexOf("whisper-");
  if (at >= 0) return `Whisper ${m.slice(at + "whisper-".length)}`;
  m = m.trim();
  return m || "Whisper";
}

function optionValue(o: EngineOption): string {
  return o.engine === "byok" ? `byok:${o.connection_id ?? ""}` : o.engine;
}

/** Gemini's tokens a second of audio, and of video at low resolution. */
const AUDIO_TOKENS_PER_SECOND = 32;
const VIDEO_TOKENS_PER_SECOND = 100;

export function EnginePicker({ estimate, recording = false }: { estimate: TranscribeEstimate; recording?: boolean }) {
  const { t, i18n } = useTranslation("knowledge");
  const fetcher = useFetcher<TranscriptActionData>();
  const [chosen, setChosen] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const unknown = recording && Boolean(estimate.length_unknown);
  const engines = estimate.engines ?? [];
  const picked = engines.find((o) => optionValue(o) === chosen && o.usable);
  const busy = fetcher.state !== "idle";
  const minutes = Math.max(1, Math.round(estimate.duration_seconds / 60));

  if (engines.length === 0) {
    return (
      <p className="mt-2 text-sm leading-prose text-muted-foreground">{recording ? t("media.none") : t("engines.none")}</p>
    );
  }

  const title = (o: EngineOption) => {
    if (o.engine === "builtin")
      return o.wait_minutes ? t("engines.builtin", { minutes: o.wait_minutes }) : t("engines.builtinNoTime");
    if (o.engine === "gemini") return t("engines.gemini");
    return t("engines.yourKey", { provider: providerName(t, o.provider) });
  };

  const detail = (o: EngineOption): string[] => {
    const lines: string[] = [];
    if (o.engine === "builtin") {
      lines.push(t(recording ? "media.builtinBody" : "engines.builtinBody", { model: whisperLabel(o.model ?? "") }));
      lines.push(
        t("engines.builtinMinutes", { used: o.used_minutes ?? 0, daily: o.daily_minutes ?? 0, need: o.audio_minutes ?? minutes }),
      );
      if (o.queue_ahead) lines.push(t("engines.builtinLine", { count: o.queue_ahead }));
    } else if (o.engine === "byok") {
      lines.push(
        t(recording ? "media.audioBody" : "engines.audioBody", {
          provider: providerName(t, o.provider),
          model: o.model ?? "",
          minutes: o.audio_minutes ?? minutes,
        }),
      );
    } else if (recording) {
      const rate = estimate.estimated_tokens > 0 && estimate.duration_seconds > 0
        ? Math.round(estimate.estimated_tokens / estimate.duration_seconds)
        : AUDIO_TOKENS_PER_SECOND;
      lines.push(t("media.geminiBody"));
      lines.push(
        estimate.duration_seconds > 0
          ? t("media.geminiEstimate", { tokens: (o.estimated_tokens ?? 0).toLocaleString(i18n.language), minutes, rate })
          : t("media.geminiEstimateUnknown", { audio: AUDIO_TOKENS_PER_SECOND, video: VIDEO_TOKENS_PER_SECOND }),
      );
    } else {
      lines.push(t("video.needs.geminiBody"));
      lines.push(
        estimate.duration_seconds > 0
          ? t("video.needs.estimate", { tokens: (o.estimated_tokens ?? 0).toLocaleString(i18n.language), minutes })
          : t("video.needs.estimateUnknown"),
      );
      lines.push(t("video.needs.freeTier", { hours: Math.round(estimate.free_tier_daily_seconds / 3600) }));
    }
    if (o.downloads && estimate.audio_blocked) lines.push(t("engines.blockedBefore"));
    return lines;
  };

  return (
    <fetcher.Form method="post" className="mt-3">
      {fetcher.data?.transcriptErrorKey ? (
        <p role="alert" className="mb-3 text-sm leading-snug text-destructive">
          {t(fetcher.data.transcriptErrorKey)}
          {fetcher.data.transcriptErrorDetail ? ` ${fetcher.data.transcriptErrorDetail}` : ""}
        </p>
      ) : null}
      <input type="hidden" name="intent" value="transcribe" />
      <input type="hidden" name="engine" value={picked?.engine ?? ""} />
      {picked?.engine === "byok" ? <input type="hidden" name="connection_id" value={picked.connection_id ?? ""} /> : null}
      <fieldset>
        <legend className="text-sm leading-prose">{t("engines.lead")}</legend>
        <ul className="mt-3 border-t">
          {engines.map((o) => {
            const value = optionValue(o);
            const id = `lp-engine-${value.replace(/[^a-z0-9-]/gi, "-")}`;
            const price = PRICE_PAGES[o.provider];
            return (
              <li key={value} className="border-b py-3">
                <div className="flex items-start gap-3">
                  <input
                    id={id}
                    type="radio"
                    name="choice"
                    value={value}
                    checked={chosen === value}
                    disabled={!o.usable}
                    onChange={() => setChosen(value)}
                    aria-describedby={`${id}-detail`}
                    className="mt-1.5 size-4 shrink-0"
                  />
                  <div className="min-w-0">
                    <label htmlFor={id} className="text-sm font-medium">
                      {title(o)}
                      {o.name && o.engine === "byok" ? (
                        <span className="ml-2 font-normal text-muted-foreground">{o.name}</span>
                      ) : null}
                    </label>
                    <div id={`${id}-detail`} className="mt-1 space-y-0.5 text-sm leading-snug text-muted-foreground">
                      {detail(o).map((line) => (
                        <p key={line}>{line}</p>
                      ))}
                      {!o.usable && o.reason ? <p className="text-warning">{o.reason}</p> : null}
                    </div>
                    {price ? (
                      <a
                        href={price}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="mt-1 inline-flex min-h-11 items-center text-sm text-primary underline-offset-2 hover:underline"
                      >
                        {t("engines.prices", { provider: providerName(t, o.provider) })}
                      </a>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </fieldset>
      {unknown ? (
        <label className="mt-3 flex min-h-11 items-start gap-3 text-sm leading-snug">
          <input
            type="checkbox"
            name="confirm_unknown_length"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.currentTarget.checked)}
            className="mt-1 size-4 shrink-0"
          />
          <span>{t("media.unknownLength")}</span>
        </label>
      ) : null}
      <p className="mt-3 text-sm leading-snug text-muted-foreground">{t("engines.label")}</p>
      <Button type="submit" className="mt-3" disabled={busy || !picked || (unknown && !confirmed)}>
        {busy ? t("video.needs.starting") : t("video.needs.start")}
      </Button>
      {!picked ? <p className="mt-1 text-xs text-muted-foreground">{t("engines.chooseFirst")}</p> : null}
    </fetcher.Form>
  );
}
