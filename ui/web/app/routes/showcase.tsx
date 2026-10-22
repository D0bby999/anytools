/**
 * showcase.tsx
 * The learner's public profile, made and changed here
 * (the private design notes): the address, the name and headline,
 * whether it is published, and its design (an accent and the blocks in
 * order), with the page previewed as a visitor will see it.
 *
 * The design is kept in this page's state and sent whole as JSON; the server
 * checks every part of it (internal/showcase/design.go). Later design
 * features are more controls here over the same document.
 */
import { useEffect, useRef, useState } from "react";
import { Form, Link, useNavigation } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import type { Route } from "./+types/showcase";
import { appTitle } from "~/lib/app-title";
import { requireUser } from "~/lib/auth.server";
import { ApiError } from "~/lib/api.server";
import { APP_URL } from "~/lib/env.server";
import { deleteShowcase, getMyShowcase, saveShowcase } from "~/lib/showcase/api.server";
import {
  ACCENTS,
  BLOCK_SPECS,
  BLOCK_TYPES,
  HANDLE_PATTERN,
  LIMITS,
  canAdd,
  move,
  showcasePath,
  type Block,
  type BlockType,
  type Design,
  type MyShowcase,
  type ShowcaseProfile,
} from "~/lib/showcase/design";
import { ShowcaseView } from "~/components/showcase/showcase-view";
import { CopyLink } from "~/components/doc/copy-link";
import { Details } from "~/components/doc/details";
import { StatusLine } from "~/components/doc/status-line";
import { FIELD } from "~/components/body/fields";
import { Button } from "~/components/ui/button";
import { PageHeader } from "~/components/ui/page-header";

const LINK = "text-primary underline underline-offset-4";
const LABEL = "block text-xs text-muted-foreground";

export function meta({ matches }: Route.MetaArgs) {
  return [{ title: appTitle(matches, "Public profile") }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await requireUser(request);
  return { mine: await getMyShowcase(user.id), origin: APP_URL };
}

/** `unreadable`: the form's design was not JSON, which only a broken page sends. */
type ActionData = { saved: ShowcaseProfile } | { deleted: true } | { error: string } | { unreadable: true };

export async function action({ request }: Route.ActionArgs): Promise<ActionData> {
  const { user } = await requireUser(request);
  const form = await request.formData();
  try {
    if (form.get("intent") === "delete") {
      await deleteShowcase(user.id);
      return { deleted: true };
    }
    let design: Design;
    try {
      design = JSON.parse(String(form.get("design") ?? "")) as Design;
    } catch {
      return { unreadable: true };
    }
    const saved = await saveShowcase(user.id, {
      handle: String(form.get("handle") ?? ""),
      name: String(form.get("name") ?? ""),
      headline: String(form.get("headline") ?? ""),
      published: form.get("published") === "on",
      indexed: form.get("indexed") === "on",
      design,
    });
    return { saved };
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) return { error: error.message };
    throw error;
  }
}

/** A block in the editor, with an id of its own so focus can follow it; the id is never saved. */
type Item = { id: number; block: Block };

/** One block's own fields: an about block's title and text, a links block's links. */
function BlockFields({ item, onChange }: { item: Item; onChange: (b: Block) => void }) {
  const { t } = useTranslation("showcase");
  const { block, id } = item;
  if (block.type === "about") {
    return (
      <div className="mt-3 grid gap-3">
        <label className={LABEL}>
          {t("editor.aboutTitle")}
          <input
            value={block.title ?? ""}
            maxLength={LIMITS.aboutTitle}
            placeholder={t("blocks.about.title")}
            onChange={(e) => onChange({ ...block, title: e.target.value })}
            className={FIELD}
          />
        </label>
        <label className={LABEL}>
          {t("editor.aboutBody")}
          <textarea
            value={block.body ?? ""}
            maxLength={LIMITS.aboutBody}
            rows={4}
            required
            onChange={(e) => onChange({ ...block, body: e.target.value })}
            className={`${FIELD} h-auto py-2`}
          />
        </label>
      </div>
    );
  }
  if (block.type === "links") {
    const links = block.links ?? [];
    const set = (next: typeof links) => onChange({ ...block, links: next });
    const note = `lp-showcase-links-note-${id}`;
    return (
      <div className="mt-3 space-y-3">
        {links.map((l, i) => (
          <fieldset key={i} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
            <legend className="sr-only">{t("editor.linkN", { n: i + 1 })}</legend>
            <label className={LABEL}>
              {t("editor.linkLabel")}
              <input
                value={l.label}
                maxLength={LIMITS.linkLabel}
                required
                onChange={(e) => set(links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
                className={FIELD}
              />
            </label>
            <label className={LABEL}>
              {t("editor.linkURL")}
              <input
                type="url"
                inputMode="url"
                value={l.url}
                maxLength={LIMITS.url}
                placeholder="https://"
                pattern="https://.+"
                required
                aria-describedby={note}
                onChange={(e) => set(links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))}
                className={FIELD}
              />
            </label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={links.length === 1}
              onClick={() => set(links.filter((_, j) => j !== i))}
              aria-label={t("editor.removeLink", { n: i + 1 })}
            >
              <Trash2 aria-hidden className="size-4" />
            </Button>
          </fieldset>
        ))}
        {links.length < LIMITS.links ? (
          <Button type="button" variant="outline" size="sm" onClick={() => set([...links, { label: "", url: "" }])}>
            {t("editor.addLink")}
          </Button>
        ) : null}
        <p className="text-xs text-muted-foreground" id={note}>
          {t("editor.linksNote")}
        </p>
      </div>
    );
  }
  return <p className="mt-1 text-sm text-muted-foreground">{t(`blocks.${block.type}.about`)}</p>;
}

/** The form's starting values: the page as stored, or a new one. */
function initial(mine: MyShowcase) {
  const p = mine.profile;
  const design = p?.design ?? mine.default_design;
  return {
    handle: p?.handle ?? "",
    name: p?.name ?? "",
    headline: p?.headline ?? "",
    published: p?.published ?? false,
    // Search engines may list a new page (owner, 2026-10-22); the learner can untick it.
    indexed: p?.indexed ?? true,
    accent: design.theme.accent,
    items: design.blocks.map((block, id) => ({ id, block })),
  };
}

export default function ShowcaseEditor({ loaderData, actionData }: Route.ComponentProps) {
  const { t } = useTranslation("showcase");
  const navigation = useNavigation();
  const { mine, origin } = loaderData;
  const saved = mine.profile;

  // A save or a delete brings the page as stored: the form starts again from
  // it. Done while rendering, not by remounting, so the status line below
  // stays the same element and its news is read out.
  const [form, setForm] = useState(() => initial(mine));
  const [shownFor, setShownFor] = useState(saved?.updated_at ?? "");
  if ((saved?.updated_at ?? "") !== shownFor) {
    setShownFor(saved?.updated_at ?? "");
    setForm(initial(mine));
  }
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });
  const nextId = useRef(1000);
  const [adding, setAdding] = useState<BlockType | "">("");
  // Where focus goes after a block moves or goes, and what is said about it.
  const [focusTo, setFocusTo] = useState<string | null>(null);
  const [news, setNews] = useState("");
  useEffect(() => {
    if (!focusTo) return;
    const el = document.getElementById(focusTo) as HTMLElement | null;
    (el && !(el as HTMLButtonElement).disabled ? el : document.getElementById("lp-showcase-blocks"))?.focus();
    setFocusTo(null);
  }, [focusTo]);

  const design: Design = { version: 1, theme: { accent: form.accent }, blocks: form.items.map((i) => i.block) };
  const label = (type: BlockType) => t(`blocks.${type}.title`);
  const setItems = (items: Item[]) => set({ items });
  const moveItem = (index: number, by: -1 | 1) => {
    const items = move(form.items, index, by);
    const item = form.items[index]!;
    setItems(items);
    // The same button again, unless the block reached the end it points to.
    const to = index + by;
    const which = by < 0 ? (to === 0 ? "down" : "up") : to === items.length - 1 ? "up" : "down";
    setFocusTo(`lp-showcase-block-${item.id}-${which}`);
    setNews(t("editor.moved", { block: label(item.block.type), n: index + by + 1, total: items.length }));
  };
  const removeItem = (index: number) => {
    const item = form.items[index]!;
    const items = form.items.filter((_, j) => j !== index);
    setItems(items);
    const next = items[index] ?? items[index - 1];
    setFocusTo(next ? `lp-showcase-block-${next.id}` : "lp-showcase-blocks");
    setNews(t("editor.removed", { block: label(item.block.type) }));
  };
  const addItem = (type: BlockType) => {
    const id = nextId.current++;
    setItems([...form.items, { id, block: BLOCK_SPECS[type].make() }]);
    setFocusTo(`lp-showcase-block-${id}`);
    setNews(t("editor.added", { block: label(type) }));
  };

  const addable = BLOCK_TYPES.filter((type) => canAdd(design, type));
  const busy = navigation.state !== "idle";
  const url = saved ? `${origin}${showcasePath(saved.handle)}` : "";
  const draft: ShowcaseProfile = {
    handle: form.handle || "…",
    name: form.name || t("editor.namePlaceholder"),
    headline: form.headline,
    published: form.published,
    indexed: form.indexed,
    design,
    updated_at: saved?.updated_at ?? "",
  };

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={t("title")}
        lede={t("lede")}
        actions={
          saved?.published ? (
            <Link to={showcasePath(saved.handle)} className={LINK} target="_blank" rel="noopener">
              {t("open")}
              {" "}
              <span className="sr-only">{t("newTab")}</span>
            </Link>
          ) : null
        }
      />

      {saved ? (
        <section aria-labelledby="lp-showcase-share" className="mt-6 lp-keybox p-5" data-part="home">
          <h2 id="lp-showcase-share" className="lp-section">
            {saved.published ? t("share.title") : t("share.draft")}
          </h2>
          {saved.published ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <code className="break-all text-sm">{url}</code>
              <CopyLink url={url} label={t("share.copy")} copiedLabel={t("share.copied")} />
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">{t("share.draftNote")}</p>
          )}
        </section>
      ) : null}

      {mine.dropped ? (
        <p role="note" className="mt-6 rounded-md border border-warning bg-warning-soft p-3 text-sm leading-snug">
          {mine.dropped < 0 ? t("editor.droppedAll") : t("editor.dropped", { count: mine.dropped })}
        </p>
      ) : null}

      <Form method="post" className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <input type="hidden" name="intent" value="save" />
        <input type="hidden" name="design" value={JSON.stringify(design)} />
        <div className="min-w-0 space-y-8">
          <section aria-labelledby="lp-showcase-you">
            <h2 id="lp-showcase-you" className="lp-section">
              {t("editor.you")}
            </h2>
            <div className="mt-3 grid gap-3">
              <label className={LABEL}>
                {t("editor.handle")}
                <span className="mt-1 flex items-center gap-1">
                  <span className="text-sm text-muted-foreground">/u/</span>
                  <input
                    name="handle"
                    value={form.handle}
                    required
                    minLength={3}
                    maxLength={30}
                    pattern={HANDLE_PATTERN}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-describedby="lp-showcase-handle-note"
                    onChange={(e) => set({ handle: e.target.value.toLowerCase() })}
                    className={`${FIELD} mt-0`}
                  />
                </span>
              </label>
              <p id="lp-showcase-handle-note" className="-mt-1 text-xs text-muted-foreground">
                {t("editor.handleNote")}
              </p>
              <label className={LABEL}>
                {t("editor.name")}
                <input name="name" value={form.name} required maxLength={LIMITS.name} onChange={(e) => set({ name: e.target.value })} className={FIELD} />
              </label>
              <label className={LABEL}>
                {t("editor.headline")}
                <input
                  name="headline"
                  value={form.headline}
                  maxLength={LIMITS.headline}
                  placeholder={t("editor.headlinePlaceholder")}
                  onChange={(e) => set({ headline: e.target.value })}
                  className={FIELD}
                />
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  name="published"
                  checked={form.published}
                  onChange={(e) => set({ published: e.target.checked })}
                  className="mt-1 size-4"
                />
                <span>
                  {t("editor.published")}
                  <span className="block text-xs text-muted-foreground">{t("editor.publishedNote")}</span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  name="indexed"
                  checked={form.indexed}
                  onChange={(e) => set({ indexed: e.target.checked })}
                  className="mt-1 size-4"
                />
                <span>
                  {t("editor.indexed")}
                  <span className="block text-xs text-muted-foreground">{t("editor.indexedNote")}</span>
                </span>
              </label>
            </div>
          </section>

          <section aria-labelledby="lp-showcase-look">
            <h2 id="lp-showcase-look" className="lp-section">
              {t("editor.look")}
            </h2>
            <fieldset className="mt-3">
              <legend className={LABEL}>{t("editor.accent")}</legend>
              <div className="mt-2 flex flex-wrap gap-2">
                {ACCENTS.map((accent) => (
                  <label
                    key={accent}
                    data-part={accent}
                    className="flex min-h-11 cursor-pointer items-center gap-2 rounded border border-control-border px-3 text-sm has-[:checked]:border-part has-[:checked]:bg-part-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary"
                  >
                    <input
                      type="radio"
                      name="accent"
                      value={accent}
                      checked={form.accent === accent}
                      onChange={() => set({ accent })}
                      className="sr-only"
                    />
                    <span aria-hidden className="size-4 rounded-full bg-part" />
                    {t(`accents.${accent}`)}
                  </label>
                ))}
              </div>
            </fieldset>

            <h3 id="lp-showcase-blocks" tabIndex={-1} className="mt-6 font-semibold">
              {t("editor.blocks")}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">{t("editor.blocksNote")}</p>
            <p role="status" className="sr-only">
              {news}
            </p>
            {form.items.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">{t("editor.noBlocks")}</p> : null}
            <ol className="mt-3 space-y-3">
              {form.items.map((item, i) => {
                const name = label(item.block.type);
                const base = `lp-showcase-block-${item.id}`;
                return (
                  <li key={item.id} className="rounded border border-border bg-card p-3">
                    <div className="flex items-center gap-2">
                      <span id={base} tabIndex={-1} className="min-w-0 flex-1 font-semibold">
                        {name}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {BLOCK_SPECS[item.block.type].data ? t("editor.counted") : t("editor.yours")}
                        </span>
                      </span>
                      <Button id={`${base}-up`} type="button" variant="ghost" size="sm" disabled={i === 0} onClick={() => moveItem(i, -1)} aria-label={t("editor.up", { block: name })}>
                        <ArrowUp aria-hidden className="size-4" />
                      </Button>
                      <Button
                        id={`${base}-down`}
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={i === form.items.length - 1}
                        onClick={() => moveItem(i, 1)}
                        aria-label={t("editor.down", { block: name })}
                      >
                        <ArrowDown aria-hidden className="size-4" />
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeItem(i)} aria-label={t("editor.remove", { block: name })}>
                        <Trash2 aria-hidden className="size-4" />
                      </Button>
                    </div>
                    <BlockFields item={item} onChange={(block) => setItems(form.items.map((x) => (x.id === item.id ? { ...x, block } : x)))} />
                  </li>
                );
              })}
            </ol>
            {addable.length > 0 ? (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <label className={`${LABEL} min-w-0 flex-1`}>
                  {t("editor.add")}
                  <select value={adding} onChange={(e) => setAdding(e.target.value as BlockType | "")} className={FIELD}>
                    <option value="">{t("editor.pick")}</option>
                    {addable.map((type) => (
                      <option key={type} value={type}>
                        {label(type)}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!adding}
                  onClick={() => {
                    if (!adding) return;
                    addItem(adding);
                    setAdding("");
                  }}
                >
                  {t("editor.addButton")}
                </Button>
              </div>
            ) : null}
          </section>

          <div>
            <Button type="submit" disabled={busy}>
              {t("editor.save")}
            </Button>
            <StatusLine tone={actionData && ("error" in actionData || "unreadable" in actionData) ? "error" : "info"}>
              {!actionData
                ? null
                : "error" in actionData
                  ? t("editor.failed", { detail: actionData.error })
                  : "unreadable" in actionData
                    ? t("editor.failed", { detail: t("editor.unreadable") })
                    : "saved" in actionData
                      ? actionData.saved.published
                        ? t("editor.savedPublished")
                        : t("editor.savedDraft")
                      : t("editor.deleted")}
            </StatusLine>
          </div>
        </div>

        <section aria-labelledby="lp-showcase-preview" className="min-w-0">
          <h2 id="lp-showcase-preview" className="lp-section">
            {t("editor.preview")}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("editor.previewNote")}</p>
          <div className="mt-3 rounded border border-border bg-background p-4 sm:p-6">
            <ShowcaseView profile={draft} stats={mine.stats} headingLevel={2} idPrefix="lp-showcase-preview" />
          </div>
        </section>
      </Form>

      {saved ? (
        <section aria-labelledby="lp-showcase-delete" className="mt-12">
          <h2 id="lp-showcase-delete" className="sr-only">
            {t("delete.title")}
          </h2>
          <Details summary={t("delete.title")}>
            <p className="mt-2 max-w-[64ch] text-sm text-muted-foreground">{t("delete.note")}</p>
            <Form method="post" className="mt-3">
              <input type="hidden" name="intent" value="delete" />
              <Button type="submit" variant="destructive" disabled={busy}>
                {t("delete.button")}
              </Button>
            </Form>
          </Details>
        </section>
      ) : null}
    </div>
  );
}
