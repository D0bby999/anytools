/**
 * apps.classroom.tsx
 * Learning apps → Google Classroom (learning-tool-connections phase 6): the
 * learner's active classes; for the one chosen (?course=<id>), where it goes
 * and what is in it, ticked by default when not yet imported.
 *
 * Importing runs in two steps when a class has Drive files: the API files
 * everything else and hands the Drive ids back; the page opens Google's
 * Picker on exactly those files (drive.file needs the learner to confirm
 * them), then the existing Drive import takes them and they are marked seen.
 */
import { Form, Link, data, useActionData, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import type { Route } from "./+types/apps.classroom";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { importFromDrive, loadDrive } from "~/lib/drive.server";
import { listKBs } from "~/lib/kb.server";
import { importItems, linkCourse, listCourses, listItems, markSeen } from "~/lib/classroom.server";
import type { ClassroomAction as ActionResult } from "~/lib/classroom-types";
import { ClassroomErrorLine as ErrorLine, CourseItems } from "~/components/apps/classroom-items";
import { addFeatureHref } from "~/components/apps/google-features";
import { PageHeader } from "~/components/ui/page-header";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/doc/badge";
import { Field } from "~/components/doc/field";

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: appTitle(matches, "Google Classroom") }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  const drive = await loadDrive(user.id).catch(() => null);
  const feature = drive?.status.features?.find((f) => f.id === "classroom");
  const base = { picker: drive?.picker ?? null, connected: Boolean(drive?.status.connected), feature: feature ?? null };
  if (!drive?.status.connected || !feature?.granted) {
    return { ...base, courses: [], items: null, course: null, kbs: [], error: null };
  }
  const courseId = new URL(request.url).searchParams.get("course");
  try {
    const [{ courses }, kbList] = await Promise.all([listCourses(user.id), listKBs(user.id)]);
    const kbs = kbList.knowledge_bases.map(({ kb }) => ({ id: kb.id, name: kb.name }));
    const course = courses.find((c) => c.id === courseId) ?? null;
    const items = course ? (await listItems(user.id, course.id)).items : null;
    return { ...base, courses, items, course, kbs, error: null };
  } catch (error) {
    if (error instanceof ApiError) return { ...base, courses: [], items: null, course: null, kbs: [], error: error.code ?? "generic" };
    throw error;
  }
}


export async function action({ request }: Route.ActionArgs) {
  const { user } = await requireUser(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const course = String(form.get("course") ?? "");
  try {
    switch (intent) {
      case "link":
        await linkCourse(user.id, course, String(form.get("name") ?? ""), String(form.get("kb_id") ?? ""));
        return data<ActionResult>({ intent, ok: true });
      case "import": {
        const keys = form.getAll("key").map(String);
        return data<ActionResult>({ intent, ok: true, report: await importItems(user.id, course, keys) });
      }
      case "drive": {
        const kbId = String(form.get("kb_id") ?? "");
        const ids = JSON.parse(String(form.get("ids") ?? "[]")) as string[];
        await importFromDrive(user.id, kbId, ids.map((id) => ({ id, kind: "file" as const })));
        await markSeen(user.id, course, ids);
        return data<ActionResult>({ intent, ok: true, count: ids.length, kbId });
      }
    }
    return data<ActionResult>({ intent, ok: false, error: "generic" }, { status: 400 });
  } catch (error) {
    if (error instanceof ApiError) return data<ActionResult>({ intent, ok: false, error: error.code ?? "generic" });
    throw error;
  }
}

export default function Classroom({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation("common");
  const { connected, feature, courses, course, items, kbs, error, picker } = loaderData;

  return (
    <div>
      <PageHeader title={t("apps.classroom.title")} lede={t("apps.classroom.lead")} />
      <div className="mt-2 text-sm">
        <Link to="/apps">{t("apps.classroom.back")}</Link>
      </div>

      {!connected ? (
        <p className="mt-8 text-sm text-muted-foreground">{t("apps.classroom.needsGoogle")}</p>
      ) : !feature?.granted ? (
        <div className="mt-8">
          {feature?.available ? (
            <Button asChild>
              <a href={addFeatureHref("classroom", "/apps/classroom")}>{t("apps.classroom.turnOn")}</a>
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">{t("apps.classroom.pending")}</p>
          )}
        </div>
      ) : error === "school_blocked" ? (
        <SchoolBlocked />
      ) : error ? (
        <ErrorLine code={error} />
      ) : (
        <>
          <section aria-labelledby="lp-classes" className="mt-10">
            <h2 id="lp-classes" className="lp-section">
              {t("apps.classroom.classes")}
            </h2>
            {courses.length === 0 ? (
              <p className="lp-empty">{t("apps.classroom.noClasses")}</p>
            ) : (
              <ul className="mt-3 divide-y divide-border rounded-md border">
                {courses.map((c) => (
                  <li key={c.id} className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 ${c.id === course?.id ? "bg-selected" : ""}`}>
                    <div className="min-w-0 flex-1 basis-56">
                      <div className="font-medium">{c.name}</div>
                      <div className="text-sm text-muted-foreground">
                        {[c.section, c.kb_id ? kbs.find((k) => k.id === c.kb_id)?.name : null].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                    {c.new > 0 ? <Badge type="tip">{t("apps.classroom.new", { count: c.new })}</Badge> : null}
                    <Button asChild variant="outline" size="sm">
                      <Link to={`?course=${encodeURIComponent(c.id)}`} aria-current={c.id === course?.id ? "true" : undefined}>
                        {t("apps.classroom.choose")}
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {course ? (
            course.kb_id ? (
              <CourseItems key={course.id} courseId={course.id} kbId={course.kb_id} items={items ?? []} picker={picker} />
            ) : (
              <LinkCourse key={course.id} courseId={course.id} name={course.name} kbs={kbs} />
            )
          ) : null}
        </>
      )}
    </div>
  );
}

function SchoolBlocked() {
  const { t } = useTranslation("common");
  return (
    <section aria-labelledby="lp-blocked" className="mt-10 rounded-md border bg-warning-soft px-4 py-4">
      <h2 id="lp-blocked" className="lp-section">
        {t("apps.classroom.blockedTitle")}
      </h2>
      <p className="mt-2 max-w-(--lp-measure-read) text-sm leading-prose">{t("apps.classroom.blockedBody")}</p>
      <ol className="lp-steps mt-2 text-sm leading-prose">
        <li>{t("apps.classroom.blocked1")}</li>
        <li>{t("apps.classroom.blocked2")}</li>
        <li>{t("apps.classroom.blocked3")}</li>
      </ol>
    </section>
  );
}

function LinkCourse({ courseId, name, kbs }: { courseId: string; name: string; kbs: { id: string; name: string }[] }) {
  const { t } = useTranslation("common");
  const busy = useNavigation().state !== "idle";
  const result = useActionData<ActionResult>();
  return (
    <section aria-labelledby="lp-link-class" className="mt-10">
      <h2 id="lp-link-class" className="lp-section">
        {t("apps.classroom.linkTitle")}
      </h2>
      <Form method="post" className="mt-3 flex flex-wrap items-end gap-2">
        <input type="hidden" name="intent" value="link" />
        <input type="hidden" name="course" value={courseId} />
        <input type="hidden" name="name" value={name} />
        <div className="min-w-0 max-w-md flex-1 basis-64 [&_.lp-field]:my-0">
          <Field label={t("apps.workspace.kb")}>
            <select name="kb_id" defaultValue="">
              <option value="">{t("apps.classroom.newKb", { name })}</option>
              {kbs.map((kb) => (
                <option key={kb.id} value={kb.id}>
                  {kb.name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Button type="submit" disabled={busy}>
          {t("apps.classroom.link")}
        </Button>
      </Form>
      {result && !result.ok ? <ErrorLine code={result.error} /> : null}
    </section>
  );
}
