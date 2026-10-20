import { useEffect, useState } from "react";
import { Form, Link, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import {
  DECISIONS,
  MAX_CONFUSABLE,
  MAX_SCENARIO,
  needsMeaning,
  RECORD_FIELDS,
  type Decision,
  type VocabNote,
  type Week,
  writable,
} from "~/lib/vocab-types";
import type { WorksheetSummary } from "~/lib/worksheet-types";
import { Button } from "~/components/ui/button";
import { DecisionFields } from "~/components/vocab/decision-picker";
import { WeekNotice } from "~/components/vocab/week-notice";
import { languageName, readingKind } from "~/lib/languages";

type ListData = { updated?: string; deleted?: string; week?: Week; errorKey?: string; errorDetail?: string };
type AuditData = { auditAdded?: number; auditFull?: boolean; errorKey?: string; errorDetail?: string };

/** The form the rows' audit checkboxes belong to. */
const AUDIT_FORM = "lp-vocab-audit";

const field = "mt-1 min-h-11 w-full rounded-md border border-control-border bg-card px-3 text-sm text-foreground";

/**
 * The learner's words: search, edit, suspend and delete. Hairline rows, the
 * language as a mono label, the source a link back to the page.
 *
 * up-methods phase 3: words to learn come first, as before, each with
 * "Practise using it" (the production card). The other four decisions are
 * grouped below with their records and a "Learn this". Any word can be
 * selected and copied into an open vocabulary audit's decision queue.
 */
export function WordList({
  notes,
  q,
  lang,
  langs,
  audits = [],
}: {
  notes: VocabNote[];
  q: string;
  lang: string;
  langs: string[];
  /** The learner's open vocabulary audits. */
  audits?: WorksheetSummary[];
}) {
  const { t, i18n } = useTranslation("vocab");
  const learning = notes.filter((n) => n.decision === "learn");
  const others = DECISIONS.filter((d) => d !== "learn")
    .map((d) => ({ decision: d, notes: notes.filter((n) => n.decision === d) }))
    .filter((g) => g.notes.length > 0);
  return (
    <>
      <Form method="get" role="search" className="mt-3 flex flex-wrap items-end gap-3">
        <label className="min-w-0 flex-1 text-xs text-muted-foreground">
          {t("list.search")}
          <input type="search" name="q" defaultValue={q} maxLength={200} className={field} />
        </label>
        <label className="text-xs text-muted-foreground">
          {t("list.language")}
          <select name="lang" defaultValue={lang} className={field}>
            <option value="">{t("list.anyLanguage")}</option>
            {langs.map((l) => (
              <option key={l} value={l}>
                {languageName(l, i18n.language)}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" variant="outline">
          {t("list.apply")}
        </Button>
      </Form>

      {notes.length === 0 ? (
        <p className="mt-3 text-sm leading-prose text-muted-foreground">
          {q || lang ? t("list.noMatch") : t("list.empty")}
        </p>
      ) : (
        <>
          <h3 className="lp-section mt-6">
            {t("byDecision.learnTitle")} · {t("byDecision.count", { count: learning.length })}
          </h3>
          <ul className="mt-2 border-t">
            {learning.map((note) => (
              <WordRow key={note.id} note={note} selectable={audits.length > 0} />
            ))}
          </ul>
          {others.length > 0 ? (
            <section aria-labelledby="lp-vocab-others" className="mt-8">
              <h3 id="lp-vocab-others" className="lp-section">
                {t("byDecision.title")}
              </h3>
              <p className="mt-1 text-xs leading-snug text-muted-foreground">{t("byDecision.lead")}</p>
              {others.map((g) => (
                <div key={g.decision} className="mt-4">
                  <h4 className="text-xs font-semibold text-muted-foreground">
                    {t(`decide.options.${g.decision}`)} · {t("byDecision.count", { count: g.notes.length })}
                  </h4>
                  <ul className="mt-1 border-t">
                    {g.notes.map((note) => (
                      <WordRow key={note.id} note={note} selectable={audits.length > 0} />
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ) : null}
          <AuditCopy audits={audits} />
        </>
      )}
    </>
  );
}

/**
 * "Add to a vocabulary audit": the selected words become rows of an open
 * audit's §3 decision queue (the route appends them one by one through the
 * worksheet's row append). Copied, not linked.
 */
function AuditCopy({ audits }: { audits: WorksheetSummary[] }) {
  const { t } = useTranslation("vocab");
  const fetcher = useFetcher<AuditData>();
  const data = fetcher.data;
  return (
    <section aria-labelledby="lp-vocab-audit-title" className="mt-8 border-t pt-4">
      <h3 id="lp-vocab-audit-title" className="lp-section">
        {t("audit.title")}
      </h3>
      <p className="mt-1 text-xs leading-snug text-muted-foreground">{t("audit.lead")}</p>
      {audits.length === 0 ? (
        <p className="mt-2 text-sm">
          {t("audit.none")}{" "}
          <Link to="/toolkit/new?kind=vocabulary_audit" className="text-primary underline underline-offset-4">
            {t("audit.start")}
          </Link>
        </p>
      ) : (
        <fetcher.Form id={AUDIT_FORM} method="post" className="mt-2 flex flex-wrap items-end gap-3">
          <input type="hidden" name="intent" value="audit" />
          <label className="min-w-0 flex-1 text-xs text-muted-foreground">
            {t("audit.worksheet")}
            <select name="worksheet" required defaultValue={audits[0]?.id} className={field}>
              {audits.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.title}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" variant="outline" disabled={fetcher.state !== "idle"}>
            {t("audit.add")}
          </Button>
        </fetcher.Form>
      )}
      {data?.auditAdded !== undefined ? (
        <p role="status" className="mt-2 text-sm">
          {data.auditFull ? t("audit.full", { count: data.auditAdded }) : t("audit.added", { count: data.auditAdded })}
        </p>
      ) : null}
      {data?.errorKey ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {data.errorKey === "audit.nothing" ? t("audit.nothing") : `${t("audit.failed")} ${data.errorDetail ?? ""}`}
        </p>
      ) : null}
    </section>
  );
}

function WordRow({ note, selectable }: { note: VocabNote; selectable: boolean }) {
  const { t } = useTranslation("vocab");
  const fetcher = useFetcher<ListData>();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // "Learn this" (another decision → learn), or "Practise using it".
  const [panel, setPanel] = useState<"learn" | "practise" | null>(null);
  const busy = fetcher.state !== "idle";
  const learning = note.decision === "learn";
  const saved = fetcher.state === "idle" && fetcher.data?.updated === note.id;
  useEffect(() => {
    if (saved) setPanel(null);
  }, [saved, fetcher.data]);

  return (
    <li className="border-b py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm font-medium" lang={note.lang}>
          {selectable ? (
            <input
              type="checkbox"
              name="note"
              value={note.id}
              form={AUDIT_FORM}
              aria-label={t("audit.select", { term: note.term })}
              className="mr-2 align-middle"
            />
          ) : null}
          {note.term}
          <span className="text-xs font-semibold ml-2 text-muted-foreground">{note.lang}</span>
          {note.pos ? <span className="ml-2 text-xs text-muted-foreground">{note.pos}</span> : null}
          {learning && note.suspended ? (
            <span className="text-xs font-semibold ml-2 text-muted-foreground">{t("list.suspended")}</span>
          ) : null}
          {learning && note.production ? (
            <span className="text-xs font-semibold ml-2 text-muted-foreground">{t("practise.on")}</span>
          ) : null}
          {learning && note.writing ? (
            <span className="text-xs font-semibold ml-2 text-muted-foreground">{t("write.on")}</span>
          ) : null}
          {learning && note.listening ? (
            <span className="text-xs font-semibold ml-2 text-muted-foreground">{t("listen.on")}</span>
          ) : null}
        </p>
        <span className="text-xs text-muted-foreground">
          {t("list.contexts", { count: note.contexts.length })}
          {note.source ? (
            <>
              {" · "}
              <Link
                to={`/documents/${note.source.document_id}${note.source.page ? `?page=${note.source.page}` : ""}`}
                className="text-primary underline underline-offset-4"
              >
                {note.source.title}
              </Link>
            </>
          ) : null}
        </span>
      </div>

      {editing ? (
        <fetcher.Form
          method="post"
          className="mt-2 grid gap-2 sm:grid-cols-2"
          onSubmit={() => setEditing(false)}
        >
          <input type="hidden" name="intent" value="update" />
          <input type="hidden" name="id" value={note.id} />
          <label className="text-xs text-muted-foreground sm:col-span-2">
            {t("list.meaning")}
            <textarea
              name="meaning"
              defaultValue={note.meaning}
              required={needsMeaning(note.decision)}
              maxLength={1000}
              rows={3}
              className={field + " py-2"}
            />
          </label>
          <label className="text-xs text-muted-foreground">
            {t(`reading.${readingKind(note.lang)}`)}
            <input name="reading" defaultValue={note.reading} maxLength={120} className={field} />
          </label>
          <label className="text-xs text-muted-foreground">
            {t("list.pos")}
            <input name="pos" defaultValue={note.pos} maxLength={40} className={field} />
          </label>
          <label className="text-xs text-muted-foreground">
            {t("list.lang")}
            <input name="lang" defaultValue={note.lang} required maxLength={11} className={field + " font-mono"} />
          </label>
          <div className="flex items-end gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {t("list.save")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t("list.cancel")}
            </Button>
          </div>
        </fetcher.Form>
      ) : (
        <>
          {note.meaning ? <p className="mt-1 text-sm leading-prose text-muted-foreground">{note.meaning}</p> : null}
          {!learning ? <RecordLines note={note} /> : null}
          {note.contexts[0] ? (
            <p className="mt-1 text-xs leading-snug text-faint" lang={note.lang}>
              “{note.contexts[0].sentence}”
            </p>
          ) : null}
          {fetcher.data?.week && fetcher.data.updated === note.id ? <WeekNotice week={fetcher.data.week} /> : null}
          <div className="mt-2 flex flex-wrap gap-1">
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
              {t("list.edit")}
            </Button>
            {learning ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    fetcher.submit(
                      { intent: "suspend", id: note.id, suspended: note.suspended ? "false" : "true" },
                      { method: "post" },
                    )
                  }
                >
                  {note.suspended ? t("list.resume") : t("list.suspend")}
                </Button>
                {note.production ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => fetcher.submit({ intent: "production-off", id: note.id }, { method: "post" })}
                  >
                    {t("practise.stop")}
                  </Button>
                ) : (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setPanel("practise")}>
                    {t("practise.start")}
                  </Button>
                )}
                {/* A listening card needs a line of a video or a recording to play. */}
                {note.listening || note.clip ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      fetcher.submit(
                        { intent: "listening", id: note.id, on: note.listening ? "false" : "true" },
                        { method: "post" },
                      )
                    }
                  >
                    {note.listening ? t("listen.stop") : t("listen.start")}
                  </Button>
                ) : null}
                {/* A writing card needs a Chinese or Japanese word with characters to draw. */}
                {note.writing || writable(note.term, note.lang) ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      fetcher.submit(
                        { intent: "writing", id: note.id, on: note.writing ? "false" : "true" },
                        { method: "post" },
                      )
                    }
                  >
                    {note.writing ? t("write.stop") : t("write.start")}
                  </Button>
                ) : null}
              </>
            ) : (
              <Button type="button" size="sm" variant="ghost" onClick={() => setPanel("learn")}>
                {t("byDecision.learnThis")}
              </Button>
            )}
            {confirming ? (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={() => fetcher.submit({ intent: "delete", id: note.id }, { method: "post" })}
              >
                {t("list.confirmDelete")}
              </Button>
            ) : (
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(true)}>
                {t("list.delete")}
              </Button>
            )}
          </div>
        </>
      )}
      {panel === "learn" ? (
        <fetcher.Form method="post" className="mt-2 border-t pt-2">
          <input type="hidden" name="intent" value="decide" />
          <input type="hidden" name="id" value={note.id} />
          <DecisionFields
            suggestion={note.meaning}
            preset="learn"
            lang={note.lang}
            initial={{ decision: note.decision, record: note.record, meaning: note.meaning, task_impact: note.task_impact }}
          />
          <div className="mt-3 flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {t("decide.save")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPanel(null)}>
              {t("decide.cancel")}
            </Button>
          </div>
        </fetcher.Form>
      ) : null}
      {panel === "practise" ? (
        <fetcher.Form method="post" className="mt-2 grid gap-2 border-t pt-2">
          <input type="hidden" name="intent" value="practise" />
          <input type="hidden" name="id" value={note.id} />
          <p className="text-xs leading-snug text-muted-foreground">{t("practise.hint")}</p>
          <label className="text-xs text-muted-foreground">
            {t("practise.scenario")}
            <textarea
              name="scenario"
              required
              maxLength={MAX_SCENARIO}
              rows={2}
              defaultValue={note.scenario}
              className={field + " py-2"}
            />
          </label>
          <label className="text-xs text-muted-foreground">
            {t("practise.confusable")}
            <input name="confusable" maxLength={MAX_CONFUSABLE} defaultValue={note.confusable} className={field} />
          </label>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {t("practise.save")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPanel(null)}>
              {t("practise.cancel")}
            </Button>
          </div>
        </fetcher.Form>
      ) : null}
      {fetcher.data?.errorKey ? (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {t("list.failed")} {fetcher.data.errorDetail}
        </p>
      ) : null}
    </li>
  );
}

/** A decision's minimum record, as the learner wrote it. */
function RecordLines({ note }: { note: VocabNote }) {
  const { t } = useTranslation("vocab");
  const lines = RECORD_FIELDS[note.decision satisfies Decision].filter((f) => note.record[f]);
  if (lines.length === 0) return null;
  return (
    <dl className="mt-1 grid gap-x-3 gap-y-0.5 text-xs sm:grid-cols-[auto_1fr]" aria-label={t("byDecision.record")}>
      {lines.map((f) => (
        <div key={f} className="contents">
          <dt className="text-muted-foreground">{t(`decide.fields.${f}`)}</dt>
          <dd>{f === "confidence" ? t(`decide.confidences.${note.record[f]}`) : note.record[f]}</dd>
        </div>
      ))}
    </dl>
  );
}
