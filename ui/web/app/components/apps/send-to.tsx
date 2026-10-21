/**
 * send-to.tsx
 * "Send to…" beside each export's "Save to my Drive" (learning-tool-
 * connections phases 7 to 9): the same export, sent to NotebookLM (a Google
 * Doc in a folder NotebookLM reads from), to Canva (a Canva Doc) or to Notion
 * (a page under one the learner shared). A dialog says where it went and how
 * to open it; an app not yet connected says where to connect it.
 */
import { useEffect, useState } from "react";
import { Link, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { ChevronDown, Send } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Dialog } from "~/components/doc/dialog";
import type { SaveToDriveData } from "~/routes/app.api.save-to-drive";
import type { ExportKind } from "~/lib/storage-types";

type Target = "notebooklm" | "canva" | "notion";
const TARGETS: Target[] = ["notebooklm", "canva", "notion"];

/** Where each target's answer may link to; anything else is not shown. */
const SAFE: Record<Target, string> = {
  notebooklm: "https://docs.google.com/",
  canva: "https://www.canva.com/",
  notion: "https://www.notion.so/",
};

export function SendTo({ kind, id, language }: { kind: ExportKind; id: string; language?: string }) {
  const { t } = useTranslation("common");
  const fetcher = useFetcher<SaveToDriveData>();
  const [menu, setMenu] = useState(false);
  const [target, setTarget] = useState<Target | null>(null);
  const [open, setOpen] = useState(false);
  const busy = fetcher.state !== "idle";
  const result = fetcher.data;
  useEffect(() => {
    if (result?.ok) setOpen(true);
  }, [result]);

  function send(to: Target) {
    setMenu(false);
    setTarget(to);
    const body: Record<string, string> = { kind, id, to };
    if (language !== undefined) body.language = language;
    fetcher.submit(body, { method: "post", action: "/app/api/save-to-drive" });
  }

  const link = result?.ok && target && result.url.startsWith(SAFE[target]) ? result.url : null;
  const code = result && !result.ok ? result.code : undefined;

  return (
    <span className="relative inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={menu}
        disabled={busy}
        onClick={() => setMenu((v) => !v)}
        className="inline-flex min-h-11 items-center gap-2 text-sm text-primary underline underline-offset-4 disabled:opacity-50"
      >
        <Send aria-hidden="true" className="size-4" />
        {busy ? t("apps.send.sending") : t("apps.send.label")}
        <ChevronDown aria-hidden="true" className="size-3.5" />
      </button>
      {menu ? (
        <ul className="absolute top-full left-0 z-20 mt-1 min-w-44 rounded-md border bg-card py-1 shadow-sm">
          {TARGETS.map((to) => (
            <li key={to}>
              <button type="button" onClick={() => send(to)} className="flex min-h-10 w-full items-center px-3 text-left text-sm hover:bg-hover">
                {t(`apps.send.${to}`)}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {result && !result.ok ? (
        <span role="alert" className="text-sm text-destructive">
          {code === "app_no_target" ? (
            t("apps.send.noParent")
          ) : code === "app_not_connected" || code === "app_reconnect" || result.errorKey === "export.reconnect" ? (
            <>
              {t("apps.send.needsApp")} <Link to="/apps">{t("apps.title")}</Link>
            </>
          ) : (
            t("apps.send.failed")
          )}
        </span>
      ) : null}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={
          target === "canva"
            ? t("apps.send.canvaTitle")
            : target === "notion"
              ? t("apps.send.notionTitle")
              : t("apps.notebooklm.doneTitle")
        }
      >
        {target === "notebooklm" ? (
          <>
            <p>{t("apps.notebooklm.doneBody", { name: result?.ok ? result.name : "" })}</p>
            <ol className="lp-steps mt-3 text-sm leading-prose">
              <li>{t("apps.notebooklm.step1")}</li>
              <li>{t("apps.notebooklm.step2")}</li>
              <li>{t("apps.notebooklm.step3")}</li>
            </ol>
          </>
        ) : (
          <p>{t(target === "canva" ? "apps.send.canvaBody" : "apps.send.notionBody", { name: result?.ok ? result.name : "" })}</p>
        )}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {target === "notebooklm" && link ? (
            <Button asChild variant="ghost">
              <a href={link} target="_blank" rel="noreferrer">
                {t("apps.notebooklm.openDoc")}
              </a>
            </Button>
          ) : null}
          {target === "notebooklm" ? (
            <Button asChild>
              <a href="https://notebooklm.google.com/" target="_blank" rel="noreferrer">
                {t("apps.notebooklm.openNotebookLM")}
              </a>
            </Button>
          ) : link ? (
            <Button asChild>
              <a href={link} target="_blank" rel="noreferrer">
                {target === "canva" ? t("apps.send.openCanva") : t("apps.send.openNotion")}
              </a>
            </Button>
          ) : null}
        </div>
      </Dialog>
    </span>
  );
}
