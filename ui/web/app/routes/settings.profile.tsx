/**
 * settings.profile.tsx
 * Settings → Learning profile: what AnyTools remembers about how the learner
 * studies, as entries they can see, edit and delete.
 *
 * Entries the learner writes are used as written. The nightly suggestions are
 * off until the learner turns them on here; what they produce are proposals,
 * listed first, which no feature reads until the learner accepts them. Every
 * suggested entry shows the evidence it rests on, as links.
 *
 * Nothing on this page calls a model.
 */
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/settings.profile";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { listKBs } from "~/lib/kb.server";
import {
  addEntry,
  clearProfile,
  decideProposal,
  deleteEntry,
  editEntry,
  getProfile,
  setConsolidation,
} from "~/lib/profile.server";
import { isSection, SECTIONS } from "~/lib/profile-types";
import { EntryRow, ProposalRow, type ProfileActionData } from "~/components/profile/profile-entries";
import { AddEntryForm, ClearProfile, ConsolidationPanel } from "~/components/profile/profile-panels";

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: appTitle(matches, "Learning profile") }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const [profile, kbs] = await Promise.all([getProfile(user.id), listKBs(user.id)]);
  return {
    profile,
    kbs: kbs.knowledge_bases.map((s) => ({ id: s.kb.id, name: s.kb.name })),
  };
}

/** The API's refusals, as the page words them. */
function errorKey(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "section_full") return "errors.full";
    if (error.code === "conflict") return "errors.conflict";
    if (error.status === 400) return "errors.invalid";
  }
  return "errors.generic";
}

export async function action({ request }: Route.ActionArgs): Promise<ProfileActionData> {
  const { user } = await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = String(form.get("id") ?? "");
  const section = String(form.get("section") ?? "");
  const text = String(form.get("text") ?? "");
  const kbID = String(form.get("kb_id") ?? "");
  try {
    switch (intent) {
      case "add":
        if (!isSection(section)) return { errorKey: "errors.invalid" };
        await addEntry(user.id, { section, text, ...(kbID ? { kb_id: kbID } : {}) });
        return { ok: "add" };
      case "edit":
        if (!isSection(section)) return { errorKey: "errors.invalid" };
        await editEntry(user.id, id, { section, text, kb_id: kbID });
        return { ok: "edit" };
      case "delete":
        await deleteEntry(user.id, id);
        return { ok: "delete" };
      case "accept":
      case "reject":
        await decideProposal(user.id, id, intent);
        return { ok: intent };
      case "consolidation":
        await setConsolidation(user.id, form.get("on") === "true");
        return { ok: "consolidation" };
      case "clear":
        await clearProfile(user.id);
        return { ok: "clear" };
    }
  } catch (error) {
    return { errorKey: errorKey(error) };
  }
  return { errorKey: "errors.generic" };
}

export default function SettingsProfile({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("profile");
  const { profile, kbs } = loaderData;
  const proposals = profile.entries.filter((e) => e.status === "proposed");
  const accepted = profile.entries.filter((e) => e.status === "accepted");

  return (
    <div className="mt-8 space-y-10">
      <p className="max-w-(--lp-measure-read) text-sm leading-prose text-muted-foreground">{t("page.lead")}</p>

      {proposals.length > 0 ? (
        <section aria-labelledby="lp-profile-proposals">
          <h2 id="lp-profile-proposals" className="lp-section">
            {t("proposals.title")}
          </h2>
          <p className="mt-3 max-w-(--lp-measure-read) text-sm leading-prose text-muted-foreground">
            {t("proposals.hint")}
          </p>
          <ul className="mt-3 border-t">
            {proposals.map((e) => (
              <ProposalRow key={e.id} entry={e} />
            ))}
          </ul>
        </section>
      ) : null}

      {SECTIONS.map((section) => {
        const rows = accepted.filter((e) => e.section === section);
        const id = `lp-profile-${section}`;
        return (
          <section key={section} aria-labelledby={id} className="border-t pt-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id={id} className="lp-section">
                {t(`sections.${section}.title`)}
              </h2>
              <span className="font-mono text-2xs text-muted-foreground">
                {t("page.count", { count: rows.length, max: profile.max_per_section })}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t(`sections.${section}.hint`)}</p>
            {rows.length === 0 ? (
              <p className="mt-3 text-sm text-faint">{t("page.empty")}</p>
            ) : (
              <ul className="mt-3 border-t">
                {rows.map((e) => (
                  <EntryRow key={e.id} entry={e} kbs={kbs} maxText={profile.max_text_runes} />
                ))}
              </ul>
            )}
          </section>
        );
      })}

      <div className="border-t pt-6">
        <AddEntryForm kbs={kbs} maxText={profile.max_text_runes} />
      </div>
      <div className="border-t pt-6">
        <ConsolidationPanel on={profile.consolidation} lastRun={profile.last_run} />
      </div>
      <div className="border-t pt-6">
        <ClearProfile count={profile.entries.length} />
      </div>
    </div>
  );
}
