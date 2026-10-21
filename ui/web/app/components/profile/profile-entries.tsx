/**
 * profile-entries.tsx
 * The learner profile's rows: an entry with its evidence, Edit and Delete,
 * and a proposal with Accept and Reject.
 *
 * Hairline rows. Evidence is a list of links to the mistake, the point, the
 * knowledge base, the word or the skill card — resolved by the API for this
 * learner, so a link to something deleted since shows as gone, not as a link.
 * Entry text is plain text: it is never rendered as Markdown or HTML.
 */
import { useState } from "react";
import { Link, useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import { refHref, SECTIONS, type ProfileEntry, type RefView } from "~/lib/profile-types";

export type ProfileActionData = { ok?: string; errorKey?: string };
export type KBOption = { id: string; name: string };

export const field = "mt-1 min-h-11 w-full rounded-md border border-control-border bg-card px-3 text-sm text-foreground";

/** The evidence an entry cites, as links. */
export function RefLinks({ refs }: { refs: RefView[] }) {
  const { t } = useTranslation("profile");
  if (refs.length === 0) return null;
  return (
    <p className="mt-1 text-xs leading-snug text-muted-foreground">
      <span className="text-xs font-semibold">{t("entry.evidence")}</span>{" "}
      {refs.map((ref, i) => {
        const href = refHref(ref);
        const kind = t(`refKinds.${ref.kind}`);
        return (
          <span key={`${ref.kind}:${ref.id}`}>
            {i > 0 ? " · " : null}
            {href ? (
              <Link to={href} className="text-primary underline underline-offset-4">
                {kind}
                {ref.label ? `: ${ref.label}` : ""}
              </Link>
            ) : (
              <span className="text-faint">
                {kind} · {t("entry.gone")}
              </span>
            )}
          </span>
        );
      })}
    </p>
  );
}

function ActionError({ data }: { data: ProfileActionData | undefined }) {
  const { t } = useTranslation("profile");
  if (!data?.errorKey) return null;
  return (
    <p role="alert" className="mt-2 text-xs text-destructive">
      {t(data.errorKey)}
    </p>
  );
}

/** One accepted entry: its text, who wrote it, its evidence, Edit and Delete. */
export function EntryRow({
  entry,
  kbs,
  maxText,
  showSource = true,
}: {
  entry: ProfileEntry;
  kbs: KBOption[];
  maxText: number;
  showSource?: boolean;
}) {
  const { t } = useTranslation("profile");
  const fetcher = useFetcher<ProfileActionData>();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const busy = fetcher.state !== "idle";

  return (
    <li className="border-b py-3">
      {editing ? (
        <fetcher.Form method="post" className="grid gap-2 sm:grid-cols-2" onSubmit={() => setEditing(false)}>
          <input type="hidden" name="intent" value="edit" />
          <input type="hidden" name="id" value={entry.id} />
          <label className="text-xs text-muted-foreground sm:col-span-2">
            {t("entry.text")}
            <textarea name="text" defaultValue={entry.text} required maxLength={maxText} rows={2} className={field + " py-2"} />
          </label>
          <label className="text-xs text-muted-foreground">
            {t("entry.section")}
            <select name="section" defaultValue={entry.section} className={field}>
              {SECTIONS.map((s) => (
                <option key={s} value={s}>
                  {t(`sections.${s}.title`)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            {t("entry.kbLabel")}
            <select name="kb_id" defaultValue={entry.kb_id ?? ""} className={field}>
              <option value="">{t("entry.anyKB")}</option>
              {kbs.map((kb) => (
                <option key={kb.id} value={kb.id}>
                  {kb.name}
                </option>
              ))}
            </select>
          </label>
          {entry.origin === "consolidated" ? <p className="text-xs text-muted-foreground sm:col-span-2">{t("entry.editHint")}</p> : null}
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" size="sm" disabled={busy}>
              {t("entry.save")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t("entry.cancel")}
            </Button>
          </div>
        </fetcher.Form>
      ) : (
        <>
          <p className="text-sm leading-prose">{entry.text}</p>
          {showSource ? (
            <>
              <p className="mt-1 text-xs text-muted-foreground">
                <span className="text-xs font-semibold">{entry.origin === "learner" ? t("entry.yours") : t("entry.fromActivity")}</span>
                {entry.kb_name ? ` · ${t("entry.kb", { name: entry.kb_name })}` : null}
              </p>
              <RefLinks refs={entry.refs} />
            </>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-1">
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
              {t("entry.edit")}
            </Button>
            {confirming ? (
              <>
                <span className="text-xs text-muted-foreground">{t("entry.confirmDelete")}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => fetcher.submit({ intent: "delete", id: entry.id }, { method: "post" })}
                >
                  {t("entry.confirmYes")}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  {t("entry.cancel")}
                </Button>
              </>
            ) : (
              <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(true)}>
                {t("entry.delete")}
              </Button>
            )}
          </div>
        </>
      )}
      <ActionError data={fetcher.data} />
    </li>
  );
}

/** One proposal from the nightly suggestions: what it would do, Accept, Reject. */
export function ProposalRow({ entry }: { entry: ProfileEntry }) {
  const { t } = useTranslation("profile");
  const fetcher = useFetcher<ProfileActionData>();
  const busy = fetcher.state !== "idle";
  const section = t(`sections.${entry.section}.title`);

  return (
    <li className="border-b py-3">
      <p className="text-xs font-semibold text-muted-foreground">{t(`proposals.${entry.op}`, { section })}</p>
      <p className={entry.op === "remove" ? "mt-1 text-sm leading-prose line-through" : "mt-1 text-sm leading-prose"}>{entry.text}</p>
      {entry.op === "update" && entry.replaces_text ? (
        <p className="mt-1 text-xs text-muted-foreground">{t("proposals.was", { text: entry.replaces_text })}</p>
      ) : null}
      {entry.kb_name ? <p className="mt-1 text-xs text-muted-foreground">{t("entry.kb", { name: entry.kb_name })}</p> : null}
      <RefLinks refs={entry.refs} />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={() => fetcher.submit({ intent: "accept", id: entry.id }, { method: "post" })}
        >
          {t("proposals.accept")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => fetcher.submit({ intent: "reject", id: entry.id }, { method: "post" })}
        >
          {t("proposals.reject")}
        </Button>
      </div>
      <ActionError data={fetcher.data} />
    </li>
  );
}
