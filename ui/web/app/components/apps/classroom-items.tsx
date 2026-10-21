/**
 * classroom-items.tsx
 * A linked class's items on Learning apps → Google Classroom
 * (learning-tool-connections phase 6), ticked by default when not yet
 * imported. After an import that hands back Drive files, Google's Picker
 * opens on exactly those files (drive.file needs the learner's
 * confirmation), and the existing Drive import takes them.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { Badge } from "~/components/doc/badge";
import { pickFromDrive, type PickError } from "~/lib/google-picker.client";
import type { ClassroomAction as ActionResult, ClassroomImport, ClassroomItem } from "~/lib/classroom-types";

const KNOWN_ERRORS = ["api_disabled", "needs_reconnect", "google_failed", "not_found"];

export function ClassroomErrorLine({ code }: { code: string }) {
  const { t } = useTranslation("common");
  return (
    <div role="alert" className="mt-3 text-sm text-destructive">
      {t(`apps.classroom.errors.${KNOWN_ERRORS.includes(code) ? code : "generic"}`)}
    </div>
  );
}

const ErrorLine = ClassroomErrorLine;

export function CourseItems({
  courseId,
  kbId,
  items,
  picker,
}: {
  courseId: string;
  kbId: string;
  items: ClassroomItem[];
  picker: { apiKey: string; appId: string } | null;
}) {
  const { t } = useTranslation("common");
  const run = useFetcher<ActionResult>();
  const drive = useFetcher<ActionResult>();
  const [checked, setChecked] = useState(() => new Set(items.filter((i) => !i.imported).map((i) => i.key)));
  const [pickError, setPickError] = useState<PickError | null>(null);
  const busy = run.state !== "idle" || drive.state !== "idle";
  const report = run.data?.ok && run.data.intent === "import" ? run.data.report : null;
  const pending = useMemo(() => report?.drive_files ?? [], [report]);
  const opened = useRef<ClassroomImport | null>(null);

  async function confirmDrive() {
    if (!picker || pending.length === 0) return;
    setPickError(null);
    const picked = await pickFromDrive(picker, { fileIds: pending, title: t("apps.classroom.confirmDrive") });
    if (!picked) return;
    if ("error" in picked) return setPickError(picked.error);
    drive.submit({ intent: "drive", course: courseId, kb_id: kbId, ids: JSON.stringify(picked.ids) }, { method: "post" });
  }

  // The Picker opens on its own once, right after the import that needs it;
  // the button stays for a learner who closed it.
  useEffect(() => {
    if (report && report.drive_files.length > 0 && opened.current !== report) {
      opened.current = report;
      void confirmDrive();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report]);

  if (items.length === 0) {
    return <p className="lp-empty mt-10">{t("apps.classroom.noItems")}</p>;
  }

  const toggle = (key: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <section aria-labelledby="lp-class-items" className="mt-10">
      <h2 id="lp-class-items" className="lp-section">
        {t("apps.classroom.items")}
      </h2>
      <run.Form method="post" className="mt-3">
        <input type="hidden" name="intent" value="import" />
        <input type="hidden" name="course" value={courseId} />
        <ul className="divide-y divide-border rounded-md border">
          {items.map((it) => (
            <li key={it.key}>
              <label className="flex min-h-11 items-start gap-3 px-4 py-2 text-sm">
                <input
                  type="checkbox"
                  name="key"
                  value={it.key}
                  checked={checked.has(it.key)}
                  onChange={() => toggle(it.key)}
                  className="mt-1"
                />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{it.title || it.from}</span>
                  {it.from && it.from !== it.title ? <span className="block text-xs text-muted-foreground">{it.from}</span> : null}
                </span>
                <Badge type="info">{t(`apps.classroom.kinds.${it.kind}`)}</Badge>
                {it.imported ? <span className="text-xs text-muted-foreground">{t("apps.classroom.imported")}</span> : null}
              </label>
            </li>
          ))}
        </ul>
        <Button type="submit" className="mt-3" disabled={busy || checked.size === 0}>
          {t("apps.classroom.importCount", { count: checked.size })}
        </Button>
      </run.Form>

      {run.data && !run.data.ok ? <ErrorLine code={run.data.error} /> : null}
      {report ? (
        <div role="status" className="mt-3 text-sm leading-prose">
          {t("apps.classroom.done", { count: report.imported })}{" "}
          <Link to={`/knowledge/${report.kb_id}`}>{t("apps.classroom.openKb")}</Link>
          {pending.length > 0 && !(drive.data?.ok && drive.data.intent === "drive") ? (
            <div className="mt-2">
              <div>{t("apps.classroom.driveNext", { count: pending.length })}</div>
              <Button type="button" variant="outline" size="sm" className="mt-2" disabled={busy || !picker} onClick={confirmDrive}>
                {t("apps.classroom.confirmDrive")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {pickError ? <ErrorLine code={pickError === "reconnect" ? "needs_reconnect" : "generic"} /> : null}
      {drive.data?.ok && drive.data.intent === "drive" ? (
        <div role="status" className="mt-2 text-sm">
          {t("apps.classroom.driveDone", { count: drive.data.count })}
        </div>
      ) : null}
      {drive.data && !drive.data.ok ? <ErrorLine code={drive.data.error} /> : null}
    </section>
  );
}
