/**
 * The rest between sets. It starts when a set is ticked, counts down on the
 * page, and says so (aria-live) and buzzes the phone when rest is over.
 * `until` is an epoch in milliseconds, so a re-render never resets it.
 */
import { Badge } from "~/components/doc/badge";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";

export function RestTimer({ until, onChange }: { until: number | null; onChange: (until: number | null) => void }) {
  const { t } = useTranslation("body");
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [until]);
  const left = until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
  // Only the ten-second boundary changes the live text; the visible clock stays precise.
  const announced = Math.ceil(left / 10) * 10;
  const over = until !== null && left === 0;
  useEffect(() => {
    if (over && typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.([200, 100, 200]);
  }, [over]);
  if (until === null) return null;
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, "0");
  return (
    <div
      data-part="practise"
      className="sticky top-0 z-sticky mt-6 flex flex-wrap items-center gap-3 rounded-lg border border-part-line bg-part-soft px-4 py-3"
    >
      <span className="text-sm font-semibold">{t("rest.title")}</span>
      <Badge type="tip" className="!h-auto !text-2xl !font-semibold tabular-nums">
        {over ? t("rest.over") : `${mm}:${ss}`}
      </Badge>
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {over ? t("rest.over") : t("up.restRemaining", { count: announced })}
      </span>
      <span className="ml-auto flex gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => onChange(Math.max(Date.now(), until) + 15000)}>
          {t("rest.more")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>
          {over ? t("rest.dismiss") : t("rest.skip")}
        </Button>
      </span>
    </div>
  );
}
