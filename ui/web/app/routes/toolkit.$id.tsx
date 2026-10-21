/**
 * toolkit.$id.tsx
 * One worksheet: the form its kind describes, its review dates, and its
 * title, status, export and deletion. The form autosaves one section at a
 * time (worksheet-form.tsx); everything else here is a plain form post.
 *
 * An English diagnostic (up methods, phase 1) also gets its row totals and
 * its "Evidence card" buttons (diagnostic-extras.tsx), so its page loads the
 * served kinds to know which evidence worksheets exist yet. A grammar error
 * map (phase 6) sorts its rows by priority and starts contrast cards from
 * them (grammar-extras.tsx).
 *
 * An artifact brief (up methods, phase 8) marks its unverified gates and,
 * once delivered, offers "Add to evidence" on its goal's chains
 * (artifact-extras.tsx), so its page loads that goal's chains.
 *
 * An AI evaluation (up f13ff2d, phase 2) shows beside its stored pass rates
 * the rates its case rows give as they are edited (evaluation-extras.tsx).
 *
 * Laid out as up's worksheet page (P2, plan 261020-2246 phase 12): the title
 * and one lede, the facts line, "Download Markdown / Copy worksheet", the
 * private notice, then each section as a numbered h2 with its input tables.
 * The worksheet actions sit outside the `.lp-doc` article so its link rule
 * does not repaint their buttons. up's "If you only have five minutes today"
 * is left out: no kind serves a minimum version yet.
 */
import { Form, redirect, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/toolkit.$id";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import * as worksheets from "~/lib/worksheets.server";
import type { FieldValue, WorksheetDetail, WorksheetKind, WritingDiagnosis } from "~/lib/worksheet-types";
import { DIAGNOSTIC_KIND } from "~/lib/english-diagnostic";
import { openEvidenceWorksheet } from "~/lib/english-diagnostic.server";
import { startContrastCard } from "~/lib/grammar.server";
import { ActionError } from "~/components/loop/action-error";
import { Button } from "~/components/ui/button";
import { PrivateNote } from "~/components/worksheet/private-note";
import { WorksheetForm, type SectionResult } from "~/components/worksheet/worksheet-form";
import { WorksheetReviews } from "~/components/worksheet/worksheet-reviews";
import { useDiagnosticExtras } from "~/components/worksheet/diagnostic-extras";
import { useGrammarExtras } from "~/components/worksheet/grammar-extras";
import { useCycleCloseExtras } from "~/components/worksheet/cycle-close-extras";
import { useEvaluationExtras } from "~/components/worksheet/evaluation-extras";
import { WorksheetMediaContext } from "~/components/worksheet/audio-cell";
import { RecordingsPanel } from "~/components/worksheet/recordings-panel";
import { WRITING_EVIDENCE, writingDiagnosisExtra, type DiagnoseResult } from "~/components/worksheet/writing-diagnosis";
import * as loop from "~/lib/loop.server";
import type { Chain } from "~/lib/loop-types";
import { ARTIFACT_BRIEF, artifactSectionExtra, useArtifactExtras } from "~/components/worksheet/artifact-extras";
import { SaveToDrive } from "~/components/storage/save-to-drive";
import { SendTo } from "~/components/apps/send-to";
import { PageHeader } from "~/components/ui/page-header";
import { BookMeta, type BookMetaItem } from "~/components/doc/book-meta";
import { Details } from "~/components/doc/details";
import { Field } from "~/components/doc/field";
import { RefTable } from "~/components/doc/ref-table";
import { WorksheetActions } from "~/components/doc/worksheet-actions";

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: appTitle(matches, "Worksheet", "Toolkit") }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  let detail: WorksheetDetail;
  try {
    detail = await worksheets.getWorksheet(user.id, params.id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) throw new Response("Not found", { status: 404 });
    throw error;
  }
  // Up-methods phase 7: a row that points at a section of another kind (the
  // speaking experiment's day 5 → the shadowing ladder) links the learner's
  // own worksheet of that kind, the most recent, when there is one.
  const related: Record<string, string> = {};
  const seen = new Set<string>();
  for (const s of detail.kind?.sections ?? [])
    for (const f of s.fields) for (const r of f.rows ?? []) if (r.see) seen.add(r.see.kind);
  // Up-methods phase 2: a worksheet on a document links the one on the same
  // document first (the listening experiment's day 5 → that video's audit).
  const documentId = detail.worksheet.document_id;
  await Promise.all(
    [...seen].map(async (kind) => {
      const [onDocument] = documentId ? await worksheets.listWorksheets(user.id, { kind, documentId }) : [];
      const [newest] = onDocument ? [onDocument] : await worksheets.listWorksheets(user.id, { kind });
      if (newest) related[kind] = newest.id;
    }),
  );
  // Up-methods phase 1: an English diagnostic opens evidence worksheets of
  // the kinds it names.
  const kinds =
    detail.worksheet.kind === DIAGNOSTIC_KIND
      ? await worksheets.listKinds(user.id).catch((): WorksheetKind[] => [])
      : [];
  // A writing evidence card shows its current draft's diagnoses (phase 4).
  let diagnoses: WritingDiagnosis[] = [];
  if (detail.kind?.kind === WRITING_EVIDENCE) {
    diagnoses = await worksheets.listDiagnoses(user.id, params.id).catch(() => []);
  }
  // An artifact brief on a goal can go on one of the goal's chains (phase 8).
  let chains: Chain[] = [];
  const stateId = detail.worksheet.state_id;
  if (detail.kind?.kind === ARTIFACT_BRIEF && stateId) {
    chains = await loop
      .getState(user.id, stateId)
      .then((s) => s.chains)
      .catch((): Chain[] => []);
  }
  return { ...detail, related, kinds, diagnoses, chains };
}

const field = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

export async function action({ request, params }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const form = await request.formData();
  const id = params.id;
  const revision = field(form, "revision");
  const intent = field(form, "intent");

  if (intent === "section") {
    const section = field(form, "section");
    let values: unknown;
    try {
      values = JSON.parse(String(form.get("values") ?? "{}"));
    } catch {
      return { section, error: "The section could not be read." } satisfies SectionResult;
    }
    try {
      const saved = await worksheets.patchWorksheet(user.id, id, { revision, answers: { [section]: values } });
      return { section, ok: true, revision: saved.updated_at } satisfies SectionResult;
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      if (error.status === 409 && error.code === "stale") {
        // Someone else wrote this section: show what the server holds now.
        const current = await worksheets.getWorksheet(user.id, id);
        return {
          section,
          conflict: true,
          values: (current.worksheet.answers[section] ?? {}) as Record<string, FieldValue>,
          revision: current.worksheet.updated_at,
        } satisfies SectionResult;
      }
      return { section, error: error.message } satisfies SectionResult;
    }
  }

  if (intent === "diagnose") {
    const pass = Number(field(form, "pass"));
    try {
      return { pass, diagnosis: await worksheets.diagnose(user.id, id, pass) } satisfies DiagnoseResult;
    } catch (error) {
      if (error instanceof ApiError) return { pass, diagnoseError: error.message } satisfies DiagnoseResult;
      throw error;
    }
  }

  try {
    switch (intent) {
      case "title":
        await worksheets.patchWorksheet(user.id, id, { revision, title: field(form, "title") });
        return { ok: true };
      case "status":
        await worksheets.patchWorksheet(user.id, id, {
          revision,
          status: field(form, "status") === "done" ? "done" : "open",
        });
        return { ok: true };
      case "moveReview":
        await worksheets.patchWorksheet(user.id, id, {
          revision,
          reviews: { [field(form, "review")]: { due: field(form, "due") } },
        });
        return { ok: true };
      case "reviewDone":
        await worksheets.patchWorksheet(user.id, id, { revision, reviews: { [field(form, "review")]: { done: true } } });
        return { ok: true };
      case "delete":
        await worksheets.deleteWorksheet(user.id, id);
        return redirect("/toolkit");
      case "addToEvidence": {
        // An artifact brief as transfer evidence on one of its goal's chains.
        const chain = field(form, "chain_id");
        await loop.addChainEvidence(user.id, chain, { kind: "worksheet", ref_id: id, timepoint: "transfer" });
        return redirect(`/loop/evidence/${encodeURIComponent(chain)}`);
      }
      case "openEvidence": {
        const opened = await openEvidenceWorksheet(user.id, id, field(form, "skill"), field(form, "prefill"));
        return "id" in opened ? redirect(`/toolkit/${opened.id}`) : opened;
      }
      case "contrastCard": {
        const opened = await startContrastCard(user.id, id, {
          sample: field(form, "sample"),
          meant: field(form, "meant"),
          decision: field(form, "decision"),
          impact: field(form, "impact"),
        });
        return "id" in opened ? redirect(`/toolkit/${opened.id}`) : opened;
      }
    }
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
  return { error: "Unknown action." };
}

const NO_KIND = { kind: "" } as WorksheetKind;

export default function ToolkitWorksheet({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation("toolkit");
  const { t: tl } = useTranslation("listening");
  const busy = useNavigation().state === "submitting";
  const { worksheet: w, kind, earlier, related, diagnoses } = loaderData;
  const recordings = w.recordings ?? [];
  const diagnosticExtras = useDiagnosticExtras({ kind: kind ?? NO_KIND, kinds: loaderData.kinds ?? [], title: w.title });
  const grammarExtras = useGrammarExtras({ kind: kind ?? NO_KIND });
  const artifactExtras = useArtifactExtras(kind ?? NO_KIND);
  // Up methods, phase 10: a cycle close's destinations say what each still needs.
  const closeExtras = useCycleCloseExtras(kind ?? NO_KIND);
  const evaluation = useEvaluationExtras(kind ?? NO_KIND, w.answers);
  const extras = diagnosticExtras ?? grammarExtras ?? artifactExtras ?? closeExtras ?? evaluation.extras;
  const pageError =
    actionData && "errorKey" in actionData
      ? { error: t(actionData.errorKey) }
      : actionData && "error" in actionData && !("section" in actionData)
        ? actionData
        : null;

  // The facts and the ways back, as up's book-meta line under the title.
  const meta: BookMetaItem[] = [
    ...(kind && kind.summary ? [{ label: kind.name }] : []),
    { label: w.status === "done" ? t("list.done") : t("list.open") },
    { label: t("sheet.back"), to: "/toolkit" },
    ...(w.state_id ? [{ label: t("sheet.goal"), to: `/loop/state/${w.state_id}` }] : []),
    ...(w.cycle_id ? [{ label: t("cycleClose.backToCycle"), to: `/loop/cycle/${w.cycle_id}` }] : []),
    // A worksheet on a video (the listening kinds, up-methods phase 2) goes
    // back to the video's "Practise listening".
    ...(w.document_id
      ? [
          kind?.document_kinds?.includes("youtube")
            ? { label: tl("backToVideo"), to: `/documents/${w.document_id}?view=listening` }
            : { label: t("sheet.document"), to: `/documents/${w.document_id}` },
        ]
      : []),
  ];

  return (
    <div>
      <PageHeader
        title={w.title}
        lede={kind ? kind.summary || kind.name : t("sheet.unknownKind")}
        className="mb-0"
      />
      <BookMeta items={meta} label={t("up.sheet.about")} />
      <WorksheetActions href={`/toolkit/${w.id}/export.md`} extra={
          <>
            <SaveToDrive kind="worksheet" id={w.id} />
            <SendTo kind="worksheet" id={w.id} />
          </>
        } />
      {w.private ? <PrivateNote kind={kind} /> : null}
      <ActionError result={pageError} />

      <div className="lp-doc">
        {kind ? (
          <>
            <WorksheetMediaContext.Provider value={{ worksheetId: w.id, recordings, related }}>
              {/* Keeping or deleting a take changes what the server holds in
                  its cells: the form starts again from the saved answers. */}
              <WorksheetForm
                key={recordings.map((r) => r.id).join(",")}
                worksheetId={w.id}
                kind={kind}
                answers={w.answers}
                revision={w.updated_at}
                extras={extras}
                onValues={evaluation.onValues}
                renderSectionExtra={
                  writingDiagnosisExtra(kind, w.id, diagnoses ?? []) ??
                  artifactSectionExtra(kind, w, loaderData.chains ?? [])
                }
              />
            </WorksheetMediaContext.Provider>
            <RecordingsPanel worksheetId={w.id} kind={kind} answers={w.answers} recordings={recordings} />
          </>
        ) : null}

        {earlier.length > 0 ? (
          <section aria-labelledby="ws-earlier">
            <h2 id="ws-earlier">{t("sheet.earlier")}</h2>
            <p className="text-muted-foreground">{t("sheet.earlierLead")}</p>
            <RefTable
              caption={t("sheet.earlier")}
              columns={[t("up.sheet.field"), t("up.sheet.value")]}
              rows={earlier.map((path) => {
                const [section = "", key = ""] = path.split(".");
                return [
                  <code key="path">{path}</code>,
                  <span key="value" className="whitespace-pre-wrap break-words">
                    {JSON.stringify(w.answers[section]?.[key] ?? null)}
                  </span>,
                ];
              })}
            />
          </section>
        ) : null}

        <section aria-labelledby="ws-manage">
          <h2 id="ws-manage">{t("sheet.manage")}</h2>
          {kind ? <WorksheetReviews kind={kind} reviews={w.reviews} revision={w.updated_at} busy={busy} /> : null}
          <Form method="post" className="flex flex-wrap items-end gap-x-3">
            <input type="hidden" name="intent" value="title" />
            <input type="hidden" name="revision" value={w.updated_at} />
            <div className="min-w-60 grow">
              <Field label={t("sheet.title")}>
                <input name="title" required maxLength={200} defaultValue={w.title} />
              </Field>
            </div>
            <Button type="submit" variant="outline" disabled={busy} className="mb-4">
              {t("sheet.rename")}
            </Button>
          </Form>
          <Form method="post">
            <input type="hidden" name="intent" value="status" />
            <input type="hidden" name="revision" value={w.updated_at} />
            <input type="hidden" name="status" value={w.status === "done" ? "open" : "done"} />
            <Button type="submit" variant="outline" disabled={busy}>
              {w.status === "done" ? t("sheet.reopen") : t("sheet.markDone")}
            </Button>
          </Form>
          <Details summary={t("sheet.delete")} className="mt-6">
            <Form method="post">
              <input type="hidden" name="intent" value="delete" />
              <p className="mt-0! text-sm text-muted-foreground">{t("sheet.deleteConfirm")}</p>
              <Button type="submit" variant="destructive" disabled={busy}>
                {t("sheet.deleteNow")}
              </Button>
            </Form>
          </Details>
        </section>
      </div>
    </div>
  );
}
