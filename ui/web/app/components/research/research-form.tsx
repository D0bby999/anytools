import type { FetcherWithComponents } from "react-router";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/doc/field";
import { CHOICE } from "~/components/solve/solve-form";

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

  return (
    <fetcher.Form method="post" className="flex flex-col gap-1">
      <input type="hidden" name="intent" value="research" />
      <Field label={t("form.query")}>
        <textarea
          id="lp-research-query"
          name="query"
          rows={3}
          required
          maxLength={4000}
          defaultValue={defaultQuery}
          placeholder={t("form.queryPlaceholder")}
          className="resize-y py-2 leading-6"
        />
      </Field>

      <fieldset className="my-2">
        <legend className="text-sm leading-6 font-medium">{t("form.mode")}</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {(["quick", "deep"] as const).map((mode) => (
            <label key={mode} className={CHOICE + " items-start"}>
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
          <Field label={t("form.kb")}>
            <select id="lp-research-kb" name="kb_id" defaultValue="">
              <option value="">{t("form.kbNone")}</option>
              {kbs.map((kb) => (
                <option key={kb.id} value={kb.id}>
                  {kb.name}
                </option>
              ))}
            </select>
          </Field>
          {webAvailable && (
            <label className="flex min-h-10 items-start gap-2 text-sm leading-6">
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

      <p className="my-2 rounded-lg bg-sunken px-4 py-3 text-sm leading-6">
        {webKeyless ? t("web.keyless") : webAvailable ? t("web.available") : t("web.missing")}{" "}
        {(webKeyless || !webAvailable) && (
          <Link to="/settings/search" className="font-medium text-primary hover:underline">
            {webKeyless ? t("web.connectKey") : t("web.connect")}
          </Link>
        )}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
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
