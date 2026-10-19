/**
 * profile-panels.tsx
 * The learner profile's forms: add an entry, the nightly-suggestions switch
 * with its last run, and "Clear profile".
 */
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { SECTIONS, type ProfileRun } from "~/lib/profile-types";
import { field, type KBOption, type ProfileActionData } from "./profile-entries";
import { formatDate } from "~/components/ui/date-text";

/** Add an entry: the learner's own words need no evidence. */
export function AddEntryForm({ kbs, maxText }: { kbs: KBOption[]; maxText: number }) {
  const { t } = useTranslation("profile");
  const fetcher = useFetcher<ProfileActionData>();
  const form = useRef<HTMLFormElement>(null);
  // A saved entry empties the form rather than leaving its text in the box.
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok === "add") form.current?.reset();
  }, [fetcher.state, fetcher.data]);

  return (
    <section aria-labelledby="lp-profile-add">
      <h2 id="lp-profile-add" className="lp-section">
        {t("add.title")}
      </h2>
      <fetcher.Form ref={form} method="post" className="mt-3 grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="intent" value="add" />
        <label className="text-xs text-muted-foreground sm:col-span-2">
          {t("add.text")}
          <textarea name="text" required maxLength={maxText} rows={2} className={field + " py-2"} />
        </label>
        <label className="text-xs text-muted-foreground">
          {t("add.section")}
          <select name="section" defaultValue="preferences" className={field}>
            {SECTIONS.map((s) => (
              <option key={s} value={s}>
                {t(`sections.${s}.title`)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted-foreground">
          {t("add.kb")}
          <select name="kb_id" defaultValue="" className={field}>
            <option value="">{t("entry.anyKB")}</option>
            {kbs.map((kb) => (
              <option key={kb.id} value={kb.id}>
                {kb.name}
              </option>
            ))}
          </select>
        </label>
        <div>
          <Button type="submit" disabled={fetcher.state !== "idle"}>
            {t("add.submit")}
          </Button>
        </div>
      </fetcher.Form>
      {fetcher.data?.errorKey ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {t(fetcher.data.errorKey)}
        </p>
      ) : null}
    </section>
  );
}

/** The nightly-suggestions switch, and what the last run did. */
export function ConsolidationPanel({ on, lastRun }: { on: boolean; lastRun: ProfileRun | null }) {
  const { t } = useTranslation("profile");
  const fetcher = useFetcher<ProfileActionData>();
  return (
    <section aria-labelledby="lp-profile-nightly">
      <h2 id="lp-profile-nightly" className="lp-section">
        {t("consolidation.title")}
      </h2>
      <p className="mt-3 max-w-(--lp-measure-read) text-sm leading-prose text-muted-foreground">
        {t("consolidation.body")}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <p role="status" className="text-sm font-medium">
          {on ? t("consolidation.stateOn") : t("consolidation.stateOff")}
        </p>
        <Button
          type="button"
          variant="outline"
          aria-pressed={on}
          disabled={fetcher.state !== "idle"}
          onClick={() => fetcher.submit({ intent: "consolidation", on: on ? "false" : "true" }, { method: "post" })}
        >
          {on ? t("consolidation.turnOff") : t("consolidation.turnOn")}
        </Button>
      </div>

      <h3 className="mt-5 text-sm font-medium">{t("consolidation.lastRun")}</h3>
      {lastRun ? <RunSummary run={lastRun} /> : (
        <p className="mt-1 text-sm text-muted-foreground">{t("consolidation.never")}</p>
      )}
    </section>
  );
}

function RunSummary({ run }: { run: ProfileRun }) {
  const { t, i18n } = useTranslation("profile");
  const when = formatDate(run.started_at, true, i18n.language);
  return (
    <div className="mt-1">
      <p className="text-sm text-muted-foreground">
        {t("consolidation.ranAt", { when, status: t(`consolidation.status.${run.status}`) })}
        {run.error ? ` · ${run.error}` : ""}
      </p>
      {run.status === "succeeded" && run.ops.length === 0 ? (
        <p className="mt-1 lp-empty">{t("consolidation.noOps")}</p>
      ) : null}
      {run.ops.length > 0 ? (
        <ul className="mt-2 border-t">
          {run.ops.map((op, i) => (
            <li key={i} className="border-b py-2 text-sm">
              <span className="text-xs font-semibold text-muted-foreground">
                {op.status === "proposed" ? t("consolidation.proposed") : t("consolidation.dropped")} · {op.op}
                {op.section ? ` · ${op.section}` : ""}
              </span>
              {op.text ? <span className="block leading-snug">{op.text}</span> : null}
              {op.reason ? <span className="block text-xs text-muted-foreground">{op.reason}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** "Clear profile": every entry, proposals included, after a confirmation. */
export function ClearProfile({ count }: { count: number }) {
  const { t } = useTranslation("profile");
  const fetcher = useFetcher<ProfileActionData>();
  const [confirming, setConfirming] = useState(false);
  return (
    <section aria-labelledby="lp-profile-clear">
      <h2 id="lp-profile-clear" className="lp-section">
        {t("clear.title")}
      </h2>
      <p className="mt-3 text-sm leading-prose text-muted-foreground">{t("clear.body")}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {confirming ? (
          <>
            <span className="text-sm">{t("clear.confirm")}</span>
            <Button
              type="button"
              variant="destructive"
              disabled={fetcher.state !== "idle"}
              onClick={() => {
                fetcher.submit({ intent: "clear" }, { method: "post" });
                setConfirming(false);
              }}
            >
              {t("clear.yes")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
              {t("clear.cancel")}
            </Button>
          </>
        ) : (
          <Button type="button" variant="outline" disabled={count === 0} onClick={() => setConfirming(true)}>
            {t("clear.start")}
          </Button>
        )}
      </div>
      {fetcher.data?.ok === "clear" ? (
        <p role="status" className="mt-2 text-sm">
          {t("clear.done")}
        </p>
      ) : null}
    </section>
  );
}
