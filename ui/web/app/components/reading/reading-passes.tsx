/**
 * reading-passes.tsx
 * "Read in five passes" in the reader's activity panel (up-methods phase 5):
 * the document's reading evidence worksheet, worked from beside the text.
 *
 *  - The current pass is the first not marked done: its job, and a box for
 *    its output. Marking it done moves on to the next.
 *  - The barriers the learner marked from the selection toolbar, newest
 *    first, each asking for its layer; a chosen layer shows the reading
 *    chapter's next step for it. A barrier on the vocabulary layer offers
 *    "Save the word": phase 3's word picker on its passage and page.
 *  - At pass 4 (rebuild with tools closed) the page closes the text and the
 *    tutor (ClosedForRebuild): the chapter rebuilds "without the original and
 *    the dictionary". Nothing on the server changes; marking the pass done
 *    brings them back.
 *
 * Writes are one section each at the revision the page loaded, like the
 * toolkit's form; the route resolves the worksheet from the document.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { TableRow, WorksheetDetail } from "~/lib/worksheet-types";
import { tablePayload } from "~/lib/worksheet-values";
import {
  BARRIERS,
  PASSES,
  REBUILD,
  barrierWord,
  barriersField,
  currentPass,
  passesField,
  storedRows,
} from "~/lib/reading-passes";
import { FieldInput, inputBox } from "~/components/worksheet/field-input";
import { Button } from "~/components/ui/button";
import { WordPicker } from "~/components/vocab/word-picker";

/** How many marked barriers the panel lists; the card has them all. */
const SHOWN_BARRIERS = 5;

type Props = {
  sheet: WorksheetDetail | null;
  busy: boolean;
  error?: string | null;
  /** A barrier was just marked: ask for its layer. */
  askLayer?: boolean;
  onStart: () => void;
  onSave: (section: typeof PASSES.section | typeof BARRIERS.section, rows: TableRow[], revision: string) => void;
};

export function ReadingPasses({ sheet, busy, error, askLayer, onStart, onSave }: Props) {
  const { t } = useTranslation("reading");

  if (!sheet) {
    return (
      <section aria-labelledby="lp-passes" className="mb-8">
        <h2 id="lp-passes" className="lp-kicker">
          {t("passes.title")}
        </h2>
        <p className="mt-3 text-sm leading-prose text-muted-foreground">{t("passes.intro")}</p>
        <Button type="button" size="sm" className="mt-3" disabled={busy} onClick={onStart}>
          {t("passes.start")}
        </Button>
        {error ? (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </section>
    );
  }

  const { worksheet, kind } = sheet;
  const field = passesField(kind);
  const rows = storedRows(sheet, PASSES);
  const current = currentPass(field, rows);
  const revision = worksheet.updated_at;

  const savePass = (rowKey: string, output: string, done: boolean) => {
    if (!field) return;
    const others = rows.filter((r) => r.row !== rowKey);
    const before = rows.find((r) => r.row === rowKey)?.cells ?? {};
    const next = [...others, { row: rowKey, cells: { ...before, output, done } }];
    onSave(PASSES.section, tablePayload(field, next), revision);
  };

  return (
    <section aria-labelledby="lp-passes" className="mb-8">
      <h2 id="lp-passes" className="lp-kicker">
        {t("passes.title")}
      </h2>

      {!field ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("passes.unavailable")}</p>
      ) : current ? (
        <CurrentPass
          key={current.row.key}
          label={current.row.label}
          job={field.columns?.find((c) => c.type === "label")?.text?.[current.row.key] ?? ""}
          position={t("passes.position", { n: current.index + 1, total: current.total })}
          stored={String(rows.find((r) => r.row === current.row.key)?.cells.output ?? "")}
          rebuild={current.row.key === REBUILD}
          busy={busy}
          onSave={(output, done) => savePass(current.row.key, output, done)}
        />
      ) : (
        <p className="mt-3 text-sm leading-prose">{t("passes.allDone")}</p>
      )}

      {error ? (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <Barriers sheet={sheet} busy={busy} askLayer={askLayer} onSave={(next) => onSave(BARRIERS.section, next, revision)} />

      <Link
        to={`/toolkit/${worksheet.id}`}
        className="mt-4 inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4"
      >
        {t("passes.openCard")}
      </Link>
    </section>
  );
}

function CurrentPass({
  label,
  job,
  position,
  stored,
  rebuild,
  busy,
  onSave,
}: {
  label: string;
  job: string;
  position: string;
  stored: string;
  rebuild: boolean;
  busy: boolean;
  onSave: (output: string, done: boolean) => void;
}) {
  const { t } = useTranslation("reading");
  const [output, setOutput] = useState(stored);
  const id = "lp-pass-output";

  return (
    <div className="mt-3">
      <p className="font-mono text-xs text-faint">{position}</p>
      <h3 className="mt-1 text-sm font-semibold">{label}</h3>
      <p className="mt-1 text-sm leading-prose text-muted-foreground">{job}</p>
      {rebuild ? (
        <p role="status" className="mt-2 rounded-md border bg-background px-3 py-2 text-xs leading-snug">
          {t("passes.rebuildRule")}
        </p>
      ) : null}
      <label htmlFor={id} className="mt-3 block text-sm font-medium">
        {t("passes.output")}
      </label>
      <textarea
        id={id}
        rows={rebuild ? 6 : 3}
        maxLength={5000}
        value={output}
        onChange={(e) => setOutput(e.target.value)}
        className={`${inputBox} mt-1`}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={busy || output.trim() === ""} onClick={() => onSave(output.trim(), true)}>
          {t("passes.markDone")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy || output.trim() === stored.trim()}
          onClick={() => onSave(output.trim(), false)}
        >
          {t("passes.save")}
        </Button>
      </div>
    </div>
  );
}

/** The marked barriers, newest first, each with its layer and that layer's next step. */
function Barriers({
  sheet,
  busy,
  askLayer,
  onSave,
}: {
  sheet: WorksheetDetail;
  busy: boolean;
  askLayer?: boolean;
  onSave: (rows: TableRow[]) => void;
}) {
  const { t } = useTranslation("reading");
  const field = barriersField(sheet.kind);
  const layer = field?.columns?.find((c) => c.key === "layer");
  const rows = storedRows(sheet, BARRIERS);
  const newest = rows.length - 1;
  // The row whose word picker is open, by its index in the stored rows.
  const [picking, setPicking] = useState<number | null>(null);

  // A barrier just marked asks for its layer: the newest row's choice.
  useEffect(() => {
    if (!askLayer || newest < 0) return;
    document.getElementById(`lp-barrier-${newest}-layer`)?.focus();
  }, [askLayer, newest]);

  if (!field || !layer) return null;
  const shown = rows
    .map((row, index) => ({ row, index }))
    .reverse()
    .slice(0, SHOWN_BARRIERS);

  const setLayer = (index: number, value: string | undefined) => {
    const next = rows.map((r, i) => {
      if (i !== index) return r;
      const cells = { ...r.cells };
      if (value) cells.layer = value;
      else delete cells.layer;
      return { ...r, cells };
    });
    onSave(tablePayload(field, next));
  };

  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold">{t("passes.barriers")}</h3>
      {rows.length === 0 ? (
        <p className="mt-1 text-sm leading-prose text-muted-foreground">{t("passes.barriersEmpty")}</p>
      ) : (
        <ul className="mt-2 border-t">
          {shown.map(({ row, index }) => {
            const page = typeof row.cells.page === "string" ? row.cells.page : "";
            const stuck = typeof row.cells.stuck === "string" ? row.cells.stuck : "";
            const placed = typeof row.cells.layer === "string" && row.cells.layer !== "";
            const word = barrierWord(row);
            return (
              <li key={index} className="border-b py-3 text-sm">
                <p className="leading-snug">
                  {page ? <span className="mr-2 font-mono text-xs text-faint">{t("passes.page", { page })}</span> : null}
                  <q>{stuck}</q>
                </p>
                <p className="mt-2 text-xs text-muted-foreground">{placed ? t("passes.layer") : t("passes.whichLayer")}</p>
                <fieldset disabled={busy} className="mt-1">
                  <FieldInput
                    field={layer}
                    id={`lp-barrier-${index}-layer`}
                    value={row.cells.layer}
                    ariaLabel={`${t("passes.layer")}: ${stuck}`}
                    onChange={(v) => setLayer(index, typeof v === "string" ? v : undefined)}
                  />
                </fieldset>
                {word ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="mt-1"
                      aria-expanded={picking === index}
                      onClick={() => setPicking(picking === index ? null : index)}
                    >
                      {picking === index ? t("barrierWord.hide") : t("barrierWord.save")}
                    </Button>
                    {picking === index ? <WordPicker selection={word.selection} page={word.page} /> : null}
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** What the document area shows at pass 4, in place of the text. */
export function ClosedForRebuild() {
  const { t } = useTranslation("reading");
  return (
    <div role="status" className="rounded-lg border bg-muted px-5 py-6">
      <p className="lp-kicker">{t("passes.closedKicker")}</p>
      <p className="mt-2 text-sm leading-prose">{t("passes.closed")}</p>
    </div>
  );
}
