/**
 * workspace-card.tsx
 * Learning apps → Google Forms and Sheets (learning-tool-connections phase
 * 5). Forms: pick a form and its graded questions join a knowledge base's
 * Quiz, or turn that Quiz into a graded form. Sheets: pick a sheet, say
 * which column is the word and which the meaning, and the rows become
 * vocabulary, paced like any import.
 *
 * Every pick goes through the Google Picker under drive.file, so AnyLearn
 * opens only the file the learner chose.
 */
import { useState } from "react";
import { Link, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { FileSpreadsheet, ListChecks } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/doc/field";
import { languageName } from "~/lib/languages";
import { pickFromDrive, type PickError } from "~/lib/google-picker.client";
import { FORM_MIME, SHEET_MIME, type WorkspaceResult } from "~/lib/workspace-types";
import type { PickerConfig } from "~/lib/drive-types";
import type { MineKB } from "~/lib/mine";

export function WorkspaceCard({
  picker,
  connected,
  kbs,
  languages,
}: {
  picker: PickerConfig;
  connected: boolean;
  kbs: MineKB[];
  languages: string[];
}) {
  const { t } = useTranslation("common");
  return (
    <section aria-labelledby="lp-workspace" className="mt-12">
      <h2 id="lp-workspace" className="lp-section">
        {t("apps.workspace.title")}
      </h2>
      <div className="mt-1 max-w-(--lp-measure-read) text-sm leading-prose text-muted-foreground">
        {t("apps.workspace.lead")}
      </div>
      <div className="mt-4 rounded-md border px-4 py-4">
        {!connected ? (
          <div className="text-sm text-muted-foreground">{t("apps.workspace.needsGoogle")}</div>
        ) : (
          <>
            <FormsBlock picker={picker} kbs={kbs} />
            <SheetsBlock picker={picker} languages={languages} />
          </>
        )}
      </div>
    </section>
  );
}

function ErrorLine({ code }: { code: string }) {
  const { t } = useTranslation("common");
  const known = ["reconnect", "notConnected", "failed", "nothing_to_import", "nothing_to_export", "api_disabled", "not_a_sheet", "not_found"];
  return (
    <div role="alert" className="mt-2 text-sm leading-snug text-destructive">
      {t(`apps.workspace.errors.${known.includes(code) ? code : "generic"}`)}
    </div>
  );
}

function FormsBlock({ picker, kbs }: { picker: PickerConfig; kbs: MineKB[] }) {
  const { t } = useTranslation("common");
  const fetcher = useFetcher<WorkspaceResult>();
  const [kbId, setKbId] = useState(kbs[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [pickError, setPickError] = useState<PickError | null>(null);
  const busy = fetcher.state !== "idle";
  const result = fetcher.data;

  async function importForm() {
    setPickError(null);
    const picked = await pickFromDrive(picker, { mimeTypes: FORM_MIME, title: t("apps.workspace.importForm") });
    if (!picked) return;
    if ("error" in picked) return setPickError(picked.error);
    fetcher.submit({ intent: "forms-import", kb_id: kbId, form_id: picked.ids[0]! }, { method: "post" });
  }

  return (
    <div>
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <ListChecks aria-hidden="true" className="size-4 text-deco" />
        {t("apps.workspace.formsTitle")}
      </h3>
      {kbs.length === 0 ? (
        <div className="mt-2 text-sm text-muted-foreground">
          {t("mine.noKb")}{" "}
          <Link to="/knowledge">{t("mine.noKbAction")}</Link>
        </div>
      ) : (
        <>
          <div className="grid gap-x-4 sm:grid-cols-2 [&_.lp-field]:mb-2">
            <Field label={t("apps.workspace.kb")}>
              <select value={kbId} onChange={(e) => setKbId(e.target.value)}>
                {kbs.map((kb) => (
                  <option key={kb.id} value={kb.id}>
                    {kb.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("apps.workspace.formTitle")}>
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
            </Field>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={importForm}>
              {t("apps.workspace.importForm")}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => fetcher.submit({ intent: "forms-export", kb_id: kbId, title }, { method: "post" })}
            >
              {t("apps.workspace.exportForm")}
            </Button>
          </div>
        </>
      )}
      {pickError ? <ErrorLine code={pickError} /> : null}
      {result && !result.ok && result.intent.startsWith("forms") ? <ErrorLine code={result.error} /> : null}
      {result?.ok && result.intent === "forms-import" ? (
        <div role="status" className="mt-2 text-sm leading-prose">
          {t("apps.workspace.imported", result.report)}
          {result.report.skipped > 0 ? (
            <div className="text-xs text-muted-foreground">{t("apps.workspace.importedHint")}</div>
          ) : null}
        </div>
      ) : null}
      {result?.ok && result.intent === "forms-export" ? (
        <div role="status" className="mt-2 text-sm leading-prose">
          {t("apps.workspace.exported", { count: result.report.questions })}
          <div className="mt-2 flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <a href={result.report.responder_uri} target="_blank" rel="noreferrer">
                {t("apps.workspace.openForm")}
              </a>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <a href={result.report.edit_uri} target="_blank" rel="noreferrer">
                {t("apps.workspace.editForm")}
              </a>
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SheetsBlock({ picker, languages }: { picker: PickerConfig; languages: string[] }) {
  const { t, i18n } = useTranslation("common");
  const preview = useFetcher<WorkspaceResult>();
  const run = useFetcher<WorkspaceResult>();
  const [lang, setLang] = useState(languages[0] ?? "");
  const [pickError, setPickError] = useState<PickError | null>(null);
  const [cols, setCols] = useState({ term: 0, meaning: 1, example: -1, header: true });

  const shown = preview.data?.ok && preview.data.intent === "sheet-preview" ? preview.data : null;
  const width = shown ? Math.max(...shown.preview.rows.map((r) => r.length), 0) : 0;
  const busy = preview.state !== "idle" || run.state !== "idle";

  async function pickSheet() {
    setPickError(null);
    const picked = await pickFromDrive(picker, { mimeTypes: SHEET_MIME, title: t("apps.workspace.pickSheet") });
    if (!picked) return;
    if ("error" in picked) return setPickError(picked.error);
    setCols({ term: 0, meaning: 1, example: -1, header: true });
    preview.submit({ intent: "sheet-preview", file_id: picked.ids[0]! }, { method: "post" });
  }

  const columnSelect = (key: "term" | "meaning" | "example", label: string, optional = false) => (
    <Field label={label}>
      <select value={cols[key]} onChange={(e) => setCols({ ...cols, [key]: Number(e.target.value) })}>
        {optional ? <option value={-1}>{t("apps.workspace.colNone")}</option> : null}
        {Array.from({ length: width }, (_, i) => (
          <option key={i} value={i}>
            {t("apps.workspace.column", { n: i + 1 })}
            {shown?.preview.rows[0]?.[i] ? `: ${shown.preview.rows[0][i]!.slice(0, 24)}` : ""}
          </option>
        ))}
      </select>
    </Field>
  );

  const done = run.data?.ok && run.data.intent === "sheet-import" ? run.data.report : null;

  return (
    <div className="mt-8">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <FileSpreadsheet aria-hidden="true" className="size-4 text-deco" />
        {t("apps.workspace.sheetsTitle")}
      </h3>
      {languages.length === 0 ? (
        <div className="mt-2 text-sm text-muted-foreground">
          {t("apps.workspace.noLanguages")} <Link to="/languages">{t("apps.workspace.noLanguagesAction")}</Link>
        </div>
      ) : (
        <>
          <div className="max-w-sm [&_.lp-field]:mb-2">
            <Field label={t("apps.workspace.language")}>
              <select value={lang} onChange={(e) => setLang(e.target.value)}>
                {languages.map((code) => (
                  <option key={code} value={code}>
                    {languageName(code, i18n.language)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={pickSheet}>
            {t("apps.workspace.pickSheet")}
          </Button>
        </>
      )}
      {pickError ? <ErrorLine code={pickError} /> : null}
      {preview.data && !preview.data.ok ? <ErrorLine code={preview.data.error} /> : null}

      {shown ? (
        <run.Form method="post" className="mt-4">
          <input type="hidden" name="intent" value="sheet-import" />
          <input type="hidden" name="file_id" value={shown.fileId} />
          <input type="hidden" name="lang" value={lang} />
          <input type="hidden" name="term" value={cols.term} />
          <input type="hidden" name="meaning" value={cols.meaning} />
          <input type="hidden" name="example" value={cols.example} />
          <input type="hidden" name="header" value={cols.header ? "1" : ""} />
          <div className="text-sm">{t("apps.workspace.sheetRows", { name: shown.preview.name, total: shown.preview.total })}</div>
          <div className="mt-2 overflow-x-auto rounded-md border" tabIndex={0} aria-label={t("apps.workspace.preview")}>
            <table className="w-full text-left text-xs">
              <caption className="sr-only">{t("apps.workspace.preview")}</caption>
              <tbody>
                {shown.preview.rows.map((row, r) => (
                  <tr key={r} className="border-b last:border-b-0">
                    {Array.from({ length: width }, (_, c) => (
                      <td key={c} className="max-w-48 truncate px-2 py-1">
                        {row[c] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 grid gap-x-4 sm:grid-cols-3 [&_.lp-field]:mb-2">
            {columnSelect("term", t("apps.workspace.colTerm"))}
            {columnSelect("meaning", t("apps.workspace.colMeaning"))}
            {columnSelect("example", t("apps.workspace.colExample"), true)}
          </div>
          <label className="flex min-h-10 items-center gap-2 text-sm">
            <input type="checkbox" checked={cols.header} onChange={(e) => setCols({ ...cols, header: e.target.checked })} />
            {t("apps.workspace.header")}
          </label>
          <Button type="submit" size="sm" disabled={busy || cols.term === cols.meaning}>
            {t("apps.workspace.importWords")}
          </Button>
        </run.Form>
      ) : null}
      {run.data && !run.data.ok ? <ErrorLine code={run.data.error} /> : null}
      {done ? (
        <div role="status" className="mt-2 text-sm leading-prose">
          {t("apps.workspace.wordsImported", done)}
          {done.first_day && done.last_day ? (
            <div className="text-xs text-muted-foreground">
              {t("apps.workspace.wordsPaced", { first: done.first_day, last: done.last_day })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
