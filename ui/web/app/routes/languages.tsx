/**
 * languages.tsx
 * Languages (plans/261020-1535-beyond-english-learning-areas, phase 1): the
 * picker. A learner with languages already lands on the one viewed last
 * (routes/languages.$lang.tsx); `?edit` opens the picker to change the list.
 * Saving keeps the learner's order, adds what was ticked after it, and opens
 * the first language added, or the current one.
 */
import { redirect } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/languages";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { isLanguageCode } from "~/lib/languages";
import { setStudiedLanguages, studiedLanguages } from "~/lib/vocab.server";
import { LanguagePicker } from "~/components/languages/language-picker";
import { PageHeader } from "~/components/ui/page-header";

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: appTitle(matches, "Languages") }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const data = await studiedLanguages(user.id);
  const edit = new URL(request.url).searchParams.has("edit");
  if (data.studied.length > 0 && !edit) throw redirect(`/languages/${data.current || data.studied[0]}`);
  return data;
}

/** The new list: the old order for what stays, then what was added, in the form's order. */
export function nextStudied(before: string[], current: string, ticked: string[]) {
  const wanted = new Set(ticked);
  const kept = before.filter((l) => wanted.has(l));
  const added = ticked.filter((l, i) => !before.includes(l) && ticked.indexOf(l) === i);
  const studied = [...kept, ...added];
  const next = added[0] ?? (studied.includes(current) ? current : studied[0]);
  return { studied, current: next ?? "" };
}

export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const form = await request.formData();
  const ticked = form.getAll("lang").map(String).filter(isLanguageCode);
  if (ticked.length === 0) return null;
  try {
    const before = await studiedLanguages(user.id);
    const { studied, current } = nextStudied(before.studied, before.current, ticked);
    await setStudiedLanguages(user.id, studied, current);
    return redirect(`/languages/${current}`);
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : "" };
  }
}

export default function Languages({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation("toolkit");
  return (
    <div className="lp-measure">
      <PageHeader title={t("languages.title")} lede={t("languages.lead")} />
      <LanguagePicker
        saved={loaderData.saved}
        studied={loaderData.studied}
        current={loaderData.current}
        error={actionData?.error}
      />
    </div>
  );
}
