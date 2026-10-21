/**
 * third-party-cards.tsx
 * Learning apps → Canva and Notion (learning-tool-connections phases 8 and
 * 9). Each card has the account row (connect, reconnect, disconnect), then
 * what the app brings in: Canva designs searched and imported as PDFs, Notion
 * pages shared at consent imported and kept in step.
 */
import { useState, type ReactNode } from "react";
import { Form, Link, useFetcher, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { Field } from "~/components/doc/field";
import { Dialog } from "~/components/doc/dialog";
import { Badge } from "~/components/doc/badge";
import { StatusPill } from "~/components/settings/readiness-matrix";
import type { AppsResult, AppStatus, NotionImported, NotionPage } from "~/lib/apps-types";
import type { MineKB } from "~/lib/mine";

const ERRORS = ["not_connected", "needs_reconnect", "not_configured", "rate_limited", "timeout", "job_failed", "not_found", "upload_refused"];

function ErrorLine({ code }: { code: string }) {
  const { t } = useTranslation("common");
  return (
    <div role="alert" className="mt-2 text-sm text-destructive">
      {t(`apps.errors.${ERRORS.includes(code) ? code : "generic"}`)}
    </div>
  );
}

const NAMES = { canva: "Canva", notion: "Notion" } as const;

function AppCard({ status, lead, children }: { status: AppStatus; lead: string; children?: ReactNode }) {
  const { t } = useTranslation("common");
  const busy = useNavigation().state !== "idle";
  const [confirming, setConfirming] = useState(false);
  const name = NAMES[status.id];
  const tone = !status.connected ? "warn" : status.needs_reconnect ? "blocked" : "green";
  return (
    <section aria-labelledby={`lp-${status.id}`} className="mt-12">
      <h2 id={`lp-${status.id}`} className="lp-section">
        {name}
      </h2>
      <div className="mt-1 max-w-(--lp-measure-read) text-sm leading-prose text-muted-foreground">{lead}</div>
      <div className="mt-4 rounded-md border">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
          <div className="min-w-0 flex-1 basis-60">
            <div className="flex flex-wrap items-baseline gap-x-2 font-medium">
              {name}
              <StatusPill
                status={tone}
                label={
                  !status.configured
                    ? t("apps.app.unavailable")
                    : status.connected
                      ? t("apps.app.connected")
                      : t("apps.app.notConnected")
                }
              />
            </div>
            {status.account ? <div className="mt-1 text-sm text-muted-foreground">{t("apps.app.account", { name: status.account })}</div> : null}
          </div>
          {status.configured ? (
            <div className="flex flex-wrap gap-2">
              {!status.connected || status.needs_reconnect ? (
                // A document navigation: /auth/app redirects to the app.
                <Button asChild size="sm">
                  <a href={`/auth/app/${status.id}`}>{status.connected ? t("apps.app.reconnect") : t("apps.app.connect")}</a>
                </Button>
              ) : null}
              {status.connected ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(true)}>
                  {t("apps.app.disconnect")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        {status.connected && !status.needs_reconnect && children ? <div className="border-t px-4 py-4">{children}</div> : null}
      </div>
      <Dialog open={confirming} onClose={() => setConfirming(false)} title={t("apps.app.disconnectTitle", { app: name })}>
        <p>{t("apps.app.disconnectBody", { app: name })}</p>
        <Form method="post" className="mt-4 flex justify-end gap-2" onSubmit={() => setConfirming(false)}>
          <input type="hidden" name="intent" value="app-disconnect" />
          <input type="hidden" name="provider" value={status.id} />
          <Button type="button" variant="ghost" onClick={() => setConfirming(false)}>
            {t("apps.app.keep")}
          </Button>
          <Button type="submit" variant="destructive" disabled={busy}>
            {t("apps.app.disconnect")}
          </Button>
        </Form>
      </Dialog>
    </section>
  );
}

function KBSelect({ kbs, value, onChange, label }: { kbs: MineKB[]; value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="max-w-sm [&_.lp-field]:my-0">
      <Field label={label}>
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {kbs.map((kb) => (
            <option key={kb.id} value={kb.id}>
              {kb.name}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}

export function CanvaCard({ status, kbs }: { status: AppStatus; kbs: MineKB[] }) {
  const { t } = useTranslation("common");
  const search = useFetcher<AppsResult>();
  const run = useFetcher<AppsResult>();
  const [kbId, setKbId] = useState(kbs[0]?.id ?? "");
  const designs = search.data?.ok && search.data.intent === "canva-search" ? search.data.designs : null;
  const done = run.data?.ok && run.data.intent === "canva-import" ? run.data : null;
  return (
    <AppCard status={status} lead={t("apps.canva.lead")}>
      {kbs.length === 0 ? (
        <div className="text-sm text-muted-foreground">{t("mine.noKb")}</div>
      ) : (
        <>
          <search.Form method="post" className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="intent" value="canva-search" />
            <div className="min-w-0 flex-1 basis-60 [&_.lp-field]:my-0">
              <Field label={t("apps.canva.search")}>
                <input name="query" type="search" />
              </Field>
            </div>
            <Button type="submit" variant="outline" disabled={search.state !== "idle"}>
              {t("apps.canva.searchButton")}
            </Button>
          </search.Form>
          {search.data && !search.data.ok ? <ErrorLine code={search.data.error} /> : null}
          {designs ? (
            designs.length === 0 ? (
              <div className="mt-3 text-sm text-muted-foreground">{t("apps.canva.noDesigns")}</div>
            ) : (
              <>
                <div className="mt-4">
                  <KBSelect kbs={kbs} value={kbId} onChange={setKbId} label={t("apps.canva.importInto")} />
                </div>
                <ul className="mt-3 divide-y divide-border rounded-md border">
                  {designs.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2">
                      <span className="min-w-0 flex-1 basis-48 truncate text-sm font-medium">{d.title || d.id}</span>
                      <run.Form method="post">
                        <input type="hidden" name="intent" value="canva-import" />
                        <input type="hidden" name="design_id" value={d.id} />
                        <input type="hidden" name="kb_id" value={kbId} />
                        <Button type="submit" variant="outline" size="sm" disabled={run.state !== "idle"}>
                          {t("apps.canva.import")}
                        </Button>
                      </run.Form>
                    </li>
                  ))}
                </ul>
              </>
            )
          ) : null}
          {run.data && !run.data.ok ? <ErrorLine code={run.data.error} /> : null}
          {done ? (
            <div role="status" className="mt-2 text-sm">
              {t("apps.canva.imported", { title: done.title })} <Link to={`/knowledge/${done.kbId}`}>{t("apps.canva.openKb")}</Link>
            </div>
          ) : null}
        </>
      )}
    </AppCard>
  );
}

export function NotionCard({
  status,
  kbs,
  pages,
  imported,
}: {
  status: AppStatus;
  kbs: MineKB[];
  pages: NotionPage[];
  imported: NotionImported[];
}) {
  const { t } = useTranslation("common");
  const run = useFetcher<AppsResult>();
  const sync = useFetcher<AppsResult>();
  const [kbId, setKbId] = useState(kbs[0]?.id ?? "");
  const [checked, setChecked] = useState(() => new Set(pages.filter((p) => !p.imported).map((p) => p.id)));
  const done = run.data?.ok && run.data.intent === "notion-import" ? run.data : null;
  const synced = sync.data?.ok && sync.data.intent === "notion-sync" ? sync.data : null;
  return (
    <AppCard status={status} lead={t("apps.notion.lead")}>
      <h3 className="text-sm font-medium">{t("apps.notion.shared")}</h3>
      {pages.length === 0 ? (
        <div className="mt-1 text-sm text-muted-foreground">{t("apps.notion.noPages")}</div>
      ) : kbs.length === 0 ? (
        <div className="mt-1 text-sm text-muted-foreground">{t("mine.noKb")}</div>
      ) : (
        <run.Form method="post" className="mt-2">
          <input type="hidden" name="intent" value="notion-import" />
          <input type="hidden" name="kb_id" value={kbId} />
          <KBSelect kbs={kbs} value={kbId} onChange={setKbId} label={t("apps.notion.importInto")} />
          <ul className="mt-3 divide-y divide-border rounded-md border">
            {pages.map((p) => (
              <li key={p.id}>
                <label className="flex min-h-11 items-center gap-3 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    name="page"
                    value={p.id}
                    checked={checked.has(p.id)}
                    onChange={() =>
                      setChecked((prev) => {
                        const next = new Set(prev);
                        if (next.has(p.id)) next.delete(p.id);
                        else next.add(p.id);
                        return next;
                      })
                    }
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">{p.title}</span>
                  <Badge type="info">{p.kind === "database" ? t("apps.notion.database") : t("apps.notion.kind")}</Badge>
                  {p.imported ? <span className="text-xs text-muted-foreground">{t("apps.notion.importedTitle")}</span> : null}
                </label>
              </li>
            ))}
          </ul>
          <Button type="submit" size="sm" className="mt-3" disabled={run.state !== "idle" || checked.size === 0}>
            {t("apps.notion.import", { count: checked.size })}
          </Button>
        </run.Form>
      )}
      {run.data && !run.data.ok ? <ErrorLine code={run.data.error} /> : null}
      {done ? (
        <div role="status" className="mt-2 text-sm">
          {t("apps.notion.imported", { imported: done.imported, failed: done.failed })}{" "}
          <Link to={`/knowledge/${done.kbId}`}>{t("apps.canva.openKb")}</Link>
        </div>
      ) : null}

      {imported.length > 0 ? (
        <>
          <h3 className="mt-6 text-sm font-medium">{t("apps.notion.importedTitle")}</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {imported.map((p) => (
              <li key={p.page_id} className="flex flex-wrap items-baseline gap-x-2">
                <Link to={`/knowledge/${p.kb_id}`}>{p.title}</Link>
                {p.gone ? <Badge type="warning">{t("apps.notion.gone")}</Badge> : null}
              </li>
            ))}
          </ul>
          <sync.Form method="post" className="mt-3">
            <input type="hidden" name="intent" value="notion-sync" />
            <Button type="submit" variant="outline" size="sm" disabled={sync.state !== "idle"}>
              {t("apps.notion.syncNow")}
            </Button>
          </sync.Form>
          {synced ? (
            <div role="status" className="mt-2 text-sm">
              {t("apps.notion.synced", { count: synced.changed })}
            </div>
          ) : null}
          {sync.data && !sync.data.ok ? <ErrorLine code={sync.data.error} /> : null}
        </>
      ) : null}
    </AppCard>
  );
}

/** The one-line answer to a consent round trip (`?app=canva-connected`). */
export function AppNoticeLine({ provider, notice }: { provider: "canva" | "notion"; notice: string }) {
  const { t } = useTranslation("common");
  const ok = notice === "connected";
  return (
    <p role={ok ? "status" : "alert"} className={`mt-6 text-sm leading-snug ${ok ? "text-primary" : "text-destructive"}`}>
      {t(`apps.app.notice.${notice}`, { app: NAMES[provider] })}
    </p>
  );
}
