/**
 * email-card.tsx
 * Learning apps → Email in (learning-tool-connections phase 4): the
 * learner's AnyLearn address, where its messages go, how to make Gmail
 * forward to it, Gmail's confirmation code when one arrives, and the last
 * messages and what each became.
 */
import { useEffect, useState, type ReactNode } from "react";
import { Form, Link, useActionData, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { CopyText } from "~/components/ui/copy-text";
import { DateText } from "~/components/ui/date-text";
import { Dialog } from "~/components/doc/dialog";
import { Field } from "~/components/doc/field";
import { Badge } from "~/components/doc/badge";
import type { InboundView } from "~/lib/inbound-types";
import type { MineKB } from "~/lib/mine";

/** A confirmation older than a day is no longer worth showing. */
const CONFIRM_FRESH_MS = 24 * 60 * 60 * 1000;

export function EmailCard({ view, kbs, children }: { view: InboundView; kbs: MineKB[]; children?: ReactNode }) {
  const { t } = useTranslation("common");
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const actionData = useActionData<{ ok?: boolean; intent?: string }>();
  const [rotating, setRotating] = useState(false);
  useEffect(() => {
    if (actionData?.intent === "email-rotate") setRotating(false);
  }, [actionData]);

  const { address, recent } = view;
  const confirmFresh =
    address.confirm_code && address.confirm_at && Date.now() - new Date(address.confirm_at).getTime() < CONFIRM_FRESH_MS;

  return (
    <section aria-labelledby="lp-email" className="mt-12">
      <h2 id="lp-email" className="lp-section">
        {t("apps.email.title")}
      </h2>
      <div className="mt-1 max-w-(--lp-measure-read) text-sm leading-prose text-muted-foreground">
        {t("apps.email.lead")}
      </div>

      <div className="mt-4 rounded-md border px-4 py-4">
        {!view.enabled ? (
          <div role="status" className="mb-4 text-sm leading-prose text-warning">
            {t("apps.email.off")}
          </div>
        ) : null}

        <label className="block text-sm font-medium" htmlFor="lp-email-address">
          {t("apps.email.addressLabel")}
        </label>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <input
            id="lp-email-address"
            readOnly
            value={address.email}
            onFocus={(e) => e.currentTarget.select()}
            className="h-10 min-w-0 flex-1 basis-72 rounded-md border bg-sunken px-3 font-mono text-sm"
          />
          <CopyText text={address.email} className="h-9 px-3 text-sm" />
        </div>

        {confirmFresh ? (
          <div role="status" className="mt-4 rounded-md border bg-warning-soft px-4 py-3 text-sm leading-prose">
            <div className="font-medium">{t("apps.email.confirmTitle")}</div>
            <div className="mt-1 tabular-nums">{t("apps.email.confirmCode", { code: address.confirm_code })}</div>
            {address.confirm_link ? (
              <Button asChild variant="outline" size="sm" className="mt-2">
                <a href={address.confirm_link} target="_blank" rel="noreferrer">
                  {t("apps.email.confirmOpen")}
                </a>
              </Button>
            ) : null}
          </div>
        ) : null}

        {kbs.length > 0 ? (
          <Form method="post" className="mt-4 flex flex-wrap items-end gap-2">
            <input type="hidden" name="intent" value="email-target" />
            <div className="min-w-0 max-w-sm flex-1 basis-60 [&_.lp-field]:my-0">
              <Field label={t("apps.email.target")}>
                <select name="kb_id" defaultValue={address.kb_id ?? ""}>
                  {address.kb_id ? null : <option value="">{t("apps.email.targetDefault")}</option>}
                  {kbs.map((kb) => (
                    <option key={kb.id} value={kb.id}>
                      {kb.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Button type="submit" variant="outline" disabled={busy}>
              {t("apps.email.save")}
            </Button>
          </Form>
        ) : null}

        <h3 className="mt-6 text-sm font-medium">{t("apps.email.gmailTitle")}</h3>
        <ol className="lp-steps mt-2 max-w-(--lp-measure-read) text-sm leading-prose">
          <li>{t("apps.email.gmail1")}</li>
          <li>{t("apps.email.gmail2")}</li>
          <li>{t("apps.email.gmail3")}</li>
          <li>{t("apps.email.gmail4")}</li>
        </ol>

        <h3 className="mt-6 text-sm font-medium">{t("apps.email.recentTitle")}</h3>
        {recent.length === 0 ? (
          <div className="mt-1 text-sm text-muted-foreground">{t("apps.email.recentEmpty")}</div>
        ) : (
          <ul className="mt-2 divide-y divide-border rounded-md border text-sm">
            {recent.map((m, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
                <span className="min-w-0 flex-1 basis-56 truncate">
                  {m.kb_id && m.status === "imported" ? (
                    <Link to={`/knowledge/${m.kb_id}`}>{m.subject || t("apps.email.noSubject")}</Link>
                  ) : (
                    m.subject || t("apps.email.noSubject")
                  )}
                </span>
                <Badge type={m.status === "imported" ? "tip" : m.status === "failed" ? "danger" : "info"}>
                  {m.status === "imported"
                    ? t("apps.email.status.imported", { count: m.documents })
                    : t(`apps.email.status.${m.status}`)}
                </Badge>
                {m.skipped > 0 ? (
                  <span className="text-xs text-muted-foreground">{t("apps.email.skipped", { count: m.skipped })}</span>
                ) : null}
                <DateText iso={m.received_at} withTime className="text-xs text-muted-foreground" />
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 text-xs leading-5 text-muted-foreground">{t("apps.email.limits")}</div>
        <div className="mt-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setRotating(true)}>
            {t("apps.email.rotate")}
          </Button>
        </div>
        {children}
      </div>

      <Dialog open={rotating} onClose={() => setRotating(false)} title={t("apps.email.rotateTitle")}>
        <p>{t("apps.email.rotateBody")}</p>
        <Form method="post" className="mt-4 flex justify-end gap-2">
          <input type="hidden" name="intent" value="email-rotate" />
          <Button type="button" variant="ghost" onClick={() => setRotating(false)}>
            {t("apps.email.keep")}
          </Button>
          <Button type="submit" variant="destructive" disabled={busy}>
            {t("apps.email.rotateConfirm")}
          </Button>
        </Form>
      </Dialog>
    </section>
  );
}
