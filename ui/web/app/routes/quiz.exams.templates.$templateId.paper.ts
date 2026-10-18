/**
 * quiz.exams.templates.$templateId.paper.ts
 * Resource route (loader only): an exam paper's stored bytes, for pdf.js on
 * the review screen (learning depth, phase 3). The browser has no route to the
 * Go API, which checks ownership. Not under app-layout, so it calls
 * requireUser itself.
 */
import type { Route } from "./+types/quiz.exams.templates.$templateId.paper";
import { requireUser } from "~/lib/auth.server";
import { fetchPaper } from "~/lib/exam.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  return fetchPaper(user.id, params.templateId, request);
}
