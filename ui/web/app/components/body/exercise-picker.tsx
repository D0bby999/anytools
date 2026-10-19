import { useEffect, useId, useState } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { useLibraryTerm } from "~/components/body/muscles";
import type { Exercise } from "~/lib/body-types";
import { Button } from "~/components/ui/button";
import { FIELD } from "~/components/body/fields";

/**
 * Search the library and pick one exercise. The search runs against the
 * /body/exercises resource route, so the 1,324-exercise library never ships
 * to the browser.
 */
export function ExercisePicker({ onPick, label }: { onPick: (e: Exercise) => void; label?: string }) {
  const { t } = useTranslation("body");
  const term = useLibraryTerm();
  const fetcher = useFetcher<{ exercises: Exercise[]; total: number }>();
  const [q, setQ] = useState("");
  const id = useId();
  const { load } = fetcher;
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const handle = window.setTimeout(() => void load(`/body/exercises?q=${encodeURIComponent(term)}`), 250);
    return () => window.clearTimeout(handle);
  }, [q, load]);
  const results = q.trim().length >= 2 ? (fetcher.data?.exercises ?? []) : [];
  return (
    <div>
      <label htmlFor={id} className="text-xs text-muted-foreground">
        {label ?? t("picker.label")}
      </label>
      <input
        id={id}
        type="search"
        value={q}
        maxLength={80}
        placeholder={t("picker.placeholder")}
        onChange={(e) => setQ(e.target.value)}
        className={FIELD}
      />
      {q.trim().length >= 2 && fetcher.state === "idle" && results.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{t("picker.none")}</p>
      ) : null}
      {results.length > 0 ? (
        <ul className="mt-2 max-h-72 divide-y overflow-y-auto rounded-md border">
          {results.map((e) => (
            <li key={e.id} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{e.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {term(e.target)} · {term(e.equipment)}
                </span>
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-label={t("picker.addNamed", { name: e.name })}
                onClick={() => {
                  onPick(e);
                  setQ("");
                }}
              >
                {t("picker.add")}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
