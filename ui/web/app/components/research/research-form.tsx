import type { FetcherWithComponents } from "react-router";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";

/**
 * The research form: the question, quick or deep, which documents to include,
 * and the one consent that matters — whether the web may be searched in a run
 * that has read those documents.
 *
 * The web notice sits ABOVE the button and says "KB-only" in words when no
 * search key is connected, so a learner knows what kind of report they are
 * about to get before they spend a call on it.
 */
export function ResearchForm<T>({
  fetcher,
  kbs,
  webAvailable,
  webKeyless = false,
  defaultQuery = "",
  busy,
  onStop,
}: {
  fetcher: FetcherWithComponents<T>;
  kbs: { id: string; name: string }[];
  webAvailable: boolean;
  /** No key, but the DuckDuckGo fallback will search the web. */
  webKeyless?: boolean;
  /** Prefilled question, e.g. an open question from an earlier report. */
  defaultQuery?: string;
  busy: boolean;
  onStop: () => void;
}) {
  const { t } = useTranslation("research");
  const submitting = fetcher.state !== "idle";
  const field = "mt-1 w-full rounded-md border border-control-border bg-background px-3 text-sm";

  return (
    <fetcher.Form method="post" className="space-y-4 rounded-lg border bg-card p-4">
      <input type="hidden" name="intent" value="research" />
      <div>
        <label htmlFor="lp-research-query" className="block text-sm font-medium">
          {t("form.query")}
        </label>
        <textarea
          id="lp-research-query"
          name="query"
          rows={3}
          required
          maxLength={4000}
          defaultValue={defaultQuery}
          placeholder={t("form.queryPlaceholder")}
          className={field + " py-2 leading-prose"}
        />
      </div>

      <fieldset>
        <legend className="text-sm font-medium">{t("form.mode")}</legend>
        <div className="mt-1 grid gap-2 sm:grid-cols-2">
          {(["quick", "deep"] as const).map((mode) => (
            <label key={mode} className="flex min-h-11 items-start gap-2 rounded-md border px-3 py-2 text-sm">
              <input type="radio" name="mode" value={mode} defaultChecked={mode === "quick"} className="mt-1" />
              <span>
                <span className="font-medium">{t(`form.${mode}`)}</span>
                <span className="block text-xs text-muted-foreground">{t(`form.${mode}Hint`)}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {kbs.length > 0 && (
        <div>
          <label htmlFor="lp-research-kb" className="block text-sm font-medium">
            {t("form.kb")}
          </label>
          <select id="lp-research-kb" name="kb_id" defaultValue="" className={field + " min-h-11"}>
            <option value="">{t("form.kbNone")}</option>
            {kbs.map((kb) => (
              <option key={kb.id} value={kb.id}>
                {kb.name}
              </option>
            ))}
          </select>
          {webAvailable && (
            <label className="mt-2 flex min-h-11 items-start gap-2 text-sm">
              <input type="checkbox" name="allow_web" value="1" className="mt-1" aria-describedby="lp-research-web-hint" />
              <span>
                {t("form.allowWeb")}
                <span id="lp-research-web-hint" className="block text-xs text-muted-foreground">
                  {t("form.allowWebHint")}
                </span>
              </span>
            </label>
          )}
        </div>
      )}

      <p className="rounded-(--lp-radius-control) bg-sunken px-3 py-2 text-sm leading-snug">
        {webKeyless ? t("web.keyless") : webAvailable ? t("web.available") : t("web.missing")}{" "}
        {(webKeyless || !webAvailable) && (
          <Link to="/settings/search" className="text-primary underline underline-offset-4">
            {webKeyless ? t("web.connectKey") : t("web.connect")}
          </Link>
        )}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        {busy ? (
          <Button type="button" variant="outline" onClick={onStop}>
            {t("form.stop")}
          </Button>
        ) : (
          <Button type="submit" disabled={submitting}>
            {submitting ? t("form.starting") : t("form.submit")}
          </Button>
        )}
      </div>
    </fetcher.Form>
  );
}
