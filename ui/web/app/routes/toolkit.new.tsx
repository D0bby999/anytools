/**
 * toolkit.new.tsx
 * Start a worksheet: `?kind=` names it, `?state=` or `?document=` attaches it
 * where its kind allows. Without a kind, the kinds are listed to choose from
 * (the "New worksheet" link on a learning state's page lands here).
 *
 * A consistency plan started on a learning state (up f13ff2d, phase 2) offers
 * to open "Three versions" with the state's next task and its minimum
 * version, shown here for the learner to confirm (lib/consistency-plan.ts).
 * The state is read with the caller's id, here and again when the plan is
 * created: another user's state is not found, like a missing one.
 */
import { Form, Link, redirect, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/toolkit.new";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import * as worksheets from "~/lib/worksheets.server";
import { ActionError } from "~/components/loop/action-error";
import { Button } from "~/components/ui/button";
import { PrivateNote } from "~/components/worksheet/private-note";
import { inputBox } from "~/components/worksheet/field-input";
import * as loop from "~/lib/loop.server";
import {
  CONSISTENCY_PLAN_KIND,
  hasPrefill,
  prefillFrom,
  versionsAnswers,
  type VersionsPrefill,
} from "~/lib/consistency-plan";
import { PageHeader } from "~/components/ui/page-header";

export function meta(_: Route.MetaArgs) {
  return [{ title: "New worksheet · Toolkit · AnyLearn" }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const url = new URL(request.url);
  const kinds = await worksheets.listKinds(user.id);
  const state = url.searchParams.get("state") ?? "";
  const document = url.searchParams.get("document") ?? "";
  // A state's page offers only the kinds that attach to a state; a document's
  // only those that attach to a document. The grammar error map does both.
  const either = (k: { attach: string }) => k.attach === "state_or_document";
  const offered = kinds.filter((k) =>
    state ? k.attach === "state" || either(k) : document ? k.attach === "document" || either(k) : true,
  );
  const kind = offered.find((k) => k.kind === url.searchParams.get("kind")) ?? null;
  let prefill: VersionsPrefill | null = null;
  if (kind?.kind === CONSISTENCY_PLAN_KIND && state) {
    prefill = prefillFrom(await stateOf(user.id, state));
    if (!hasPrefill(prefill)) prefill = null;
  }
  return { kinds: offered, kind, state, document, prefill };
}

/** The caller's own learning state; anyone else's is a 404, like a missing one. */
async function stateOf(userId: string, stateId: string) {
  try {
    return (await loop.getState(userId, stateId)).state;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) throw new Response("Not found", { status: 404 });
    throw error;
  }
}

const field = (form: FormData, name: string) => String(form.get(name) ?? "").trim();

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const form = await request.formData();
  const kind = field(form, "kind");
  const state = field(form, "state");
  try {
    // The prefill is read again here from the caller's own state, never
    // taken from the form.
    const prefill =
      kind === CONSISTENCY_PLAN_KIND && state && form.get("prefill") === "on"
        ? versionsAnswers(prefillFrom(await stateOf(user.id, state)))
        : {};
    const created = await worksheets.createWorksheet(user.id, {
      kind,
      title: field(form, "title"),
      ...(state ? { state_id: state } : {}),
      ...(field(form, "document") ? { document_id: field(form, "document") } : {}),
    });
    if (Object.keys(prefill).length > 0) {
      await worksheets.patchWorksheet(user.id, created.id, { revision: created.updated_at, answers: prefill });
    }
    return redirect(`/toolkit/${created.id}`);
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    throw error;
  }
}

export default function ToolkitNew({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation("toolkit");
  const busy = useNavigation().state === "submitting";
  const { kinds, kind, state, document, prefill } = loaderData;
  const carry = (k: string) => {
    const params = new URLSearchParams({ kind: k });
    if (state) params.set("state", state);
    if (document) params.set("document", document);
    return `/toolkit/new?${params.toString()}`;
  };

  if (!kind) {
    return (
      <div className="lp-measure">
        <PageHeader title={t("new.chooseTitle")} lede={t("new.chooseLead")} />
        {kinds.length === 0 ? <p className="mt-6 lp-empty">{t("index.noKinds")}</p> : null}
        <ul className="mt-6 border-t">
          {kinds.map((k) => (
            <li key={k.kind} className="border-b">
              <Link
                to={carry(k.kind)}
                className="block min-h-11 px-1 py-3 transition-colors hover:bg-primary-soft focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
              >
                <span className="block text-sm font-medium">{k.name}</span>
                <span className="block text-sm text-muted-foreground">{k.summary}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="lp-measure">
      <PageHeader title={t("new.title", { name: kind.name })} lede={kind.summary} />
      {kind.private ? <PrivateNote kind={kind} /> : null}
      <ActionError result={actionData} />
      <Form method="post" className="mt-6 space-y-4">
        <input type="hidden" name="kind" value={kind.kind} />
        <input type="hidden" name="state" value={state} />
        <input type="hidden" name="document" value={document} />
        <label className="block text-sm font-medium">
          {t("new.titleLabel")}
          <input name="title" required maxLength={200} defaultValue={kind.name} className={`${inputBox} mt-1`} />
        </label>
        {prefill ? <PrefillChoice prefill={prefill} /> : null}
        <Button type="submit" disabled={busy}>
          {t("new.start")}
        </Button>
      </Form>
    </div>
  );
}

/** The consistency plan's start from the goal, confirmed by the learner. */
function PrefillChoice({ prefill }: { prefill: VersionsPrefill }) {
  const { t } = useTranslation("toolkit");
  return (
    <fieldset className="rounded-md border p-4">
      <legend className="lp-kicker px-1">{t("consistency.prefillTitle")}</legend>
      <p className="text-sm text-muted-foreground">{t("consistency.prefillLead")}</p>
      <dl className="mt-3 border-t text-sm">
        {prefill.minimum ? (
          <div className="border-b py-2">
            <dt className="font-mono text-xs text-faint">{t("consistency.minimum")}</dt>
            <dd className="mt-1 whitespace-pre-wrap break-words">{prefill.minimum}</dd>
          </div>
        ) : null}
        {prefill.standard ? (
          <div className="border-b py-2">
            <dt className="font-mono text-xs text-faint">{t("consistency.standard")}</dt>
            <dd className="mt-1 whitespace-pre-wrap break-words">{prefill.standard}</dd>
          </div>
        ) : null}
      </dl>
      <label className="mt-3 flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" name="prefill" defaultChecked className="size-5 accent-primary" />
        {t("consistency.prefillConfirm")}
      </label>
    </fieldset>
  );
}
