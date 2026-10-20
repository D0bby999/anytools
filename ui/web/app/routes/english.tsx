/**
 * english.tsx
 * The English page became Languages (plans/261020-1535-beyond-english-
 * learning-areas, decision 2). An old link lands on English's tab; a learner
 * who followed one is learning English, so English joins their list.
 */
import { redirect } from "react-router";
import type { Route } from "./+types/english";
import { requireUser } from "~/lib/auth.server";
import { setStudiedLanguages, studiedLanguages } from "~/lib/vocab.server";

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const { studied } = await studiedLanguages(user.id);
  if (!studied.includes("en")) await setStudiedLanguages(user.id, [...studied, "en"], "en");
  return redirect("/languages/en");
}
