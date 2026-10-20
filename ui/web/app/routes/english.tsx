/**
 * english.tsx
 * English: one page for the English practice the app already has, by skill.
 * It adds no practice of its own: the diagnostic first, then each skill's
 * worksheets from the Toolkit, where its practice lives (a video's listening
 * practice, a document's five passes, the vocabulary deck), and the learner's
 * worksheets of each. Kinds come from the API, in the learner's language; a
 * kind the server does not serve is left out.
 */
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/english";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import * as worksheets from "~/lib/worksheets.server";
import { dueCards } from "~/lib/vocab.server";
import type { WorksheetKind } from "~/lib/worksheet-types";
import { KindRow } from "~/components/worksheet/toolkit-groups";
import { PageHeader } from "~/components/ui/page-header";

export const DIAGNOSTIC = "english_diagnostic";

/** Each skill's kinds, in the order the page shows them. */
export const SKILLS = [
  { id: "listening", kinds: ["listening_audit", "listening_experiment"] },
  { id: "reading", kinds: ["reading_evidence"] },
  { id: "speaking", kinds: ["speaking_evidence", "speaking_experiment"] },
  { id: "writing", kinds: ["writing_evidence"] },
  { id: "vocabulary", kinds: ["vocabulary_audit"] },
  { id: "grammar", kinds: ["grammar_error_map", "grammar_evidence"] },
  { id: "work", kinds: ["interview_evidence"] },
] as const;

/** Where a skill's practice is, beyond its worksheets. */
const PRACTICE: Partial<Record<(typeof SKILLS)[number]["id"], string>> = {
  listening: "/knowledge",
  reading: "/knowledge",
  vocabulary: "/mastery/vocabulary",
};

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: appTitle(matches, "English") }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const [kinds, list, vocabDue] = await Promise.all([
    worksheets.listKinds(user.id),
    worksheets.listWorksheets(user.id),
    dueCards(user.id, 1)
      .then((d) => d.due_count)
      .catch(() => null),
  ]);
  return { kinds, list, vocabDue };
}

const LINK = "inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4";

export default function English({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("toolkit");
  const { kinds, list, vocabDue } = loaderData;
  const byId = new Map(kinds.map((k) => [k.kind, k]));
  const diagnostic = byId.get(DIAGNOSTIC);
  // A kind that attaches to a document starts from that document, not here;
  // a listening kind's is a video or a recording.
  const start = (k: WorksheetKind) => {
    if (k.attach !== "document") return undefined;
    const from = k.document_kinds?.includes("youtube") ? "fromRecording" : "fromDocument";
    return (
      <Link to="/knowledge" className={LINK} aria-label={t(`english.${from}Of`, { name: k.name })}>
        {t(`english.${from}`)}
      </Link>
    );
  };
  return (
    <div className="lp-measure">
      <PageHeader title={t("english.title")} lede={t("english.lead")} />
      {diagnostic ? (
        <section aria-labelledby="en-start" className="mt-8">
          <h2 id="en-start" className="lp-section">
            {t("english.start.title")}
          </h2>
          <p className="mt-1 text-sm leading-prose text-muted-foreground">{t("english.start.body")}</p>
          <ul className="mt-3 border-t">
            <KindRow kind={diagnostic} list={list} />
          </ul>
        </section>
      ) : null}
      {SKILLS.map((skill) => {
        const inSkill = skill.kinds.map((id) => byId.get(id)).filter((k): k is WorksheetKind => k !== undefined);
        const practice = PRACTICE[skill.id];
        if (inSkill.length === 0 && !practice) return null;
        return (
          <section key={skill.id} aria-labelledby={`en-${skill.id}`} className="mt-10">
            <h2 id={`en-${skill.id}`} className="lp-section">
              {t(`english.skills.${skill.id}.title`)}
            </h2>
            <p className="mt-1 text-sm leading-prose text-muted-foreground">{t(`english.skills.${skill.id}.body`)}</p>
            {skill.id === "vocabulary" && vocabDue ? (
              <p className="mt-1 text-sm leading-prose">{t("english.vocabDue", { count: vocabDue })}</p>
            ) : null}
            {practice ? (
              <Link to={practice} className={LINK}>
                {t(`english.skills.${skill.id}.open`)}
              </Link>
            ) : null}
            {inSkill.length > 0 ? (
              <ul className="mt-3 border-t">
                {inSkill.map((k) => (
                  <KindRow key={k.kind} kind={k} list={list} start={start(k)} />
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
