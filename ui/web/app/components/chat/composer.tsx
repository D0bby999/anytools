import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Send, Square } from "lucide-react";
import { Button } from "~/components/ui/button";
import { OwnVersionFields } from "~/components/chat/own-version-fields";
import { ModelChip, type ModelOption } from "~/components/chat/composer/model-chip";
import { ContextMeter } from "~/components/chat/composer/context-meter";
import { MAX_QUEUED, QueueDock } from "~/components/chat/composer/queue-dock";
import { optionId, TriggerMenu, type TriggerItem } from "~/components/chat/composer/trigger-menu";
import {
  AttachButton,
  AttachmentRail,
  DropOverlay,
  MAX_PHOTO_BYTES,
  useFileDrop,
  type PhotoAttachment,
  type Reference,
  type UploadChip,
} from "~/components/chat/composer/attachments";
import { MicButton } from "~/components/chat/composer/mic-button";
import { uploadAction } from "~/components/knowledge/upload-dropzone";
import { fold } from "~/lib/chat-search";
import { dropMention, matchCommands, mentionAt, slashQuery, type SlashCommand } from "~/lib/chat-slash";
import { preparePhoto } from "~/lib/image-resize";
import { isPhotoFile } from "~/lib/kb-types";
import { emptyOwnVersion, ownVersionComplete, type OwnVersion } from "~/lib/own-version";

export { modelKey, type ModelOption } from "~/components/chat/composer/model-chip";
export { MAX_QUEUED } from "~/components/chat/composer/queue-dock";
export type { Reference } from "~/components/chat/composer/attachments";

/** What goes with a message besides its text. */
export type SendExtra = { references?: Reference[]; photo?: File };

const MAX_HEIGHT = 160;
/** A question may point at up to this many documents (chatapi.maxReferences). */
const MAX_REFERENCES = 8;
/** The `@` menu lists at most this many documents. */
const MENU_DOCUMENTS = 8;

type Menu = { kind: "slash"; query: string } | { kind: "mention"; query: string; start: number };

/**
 * The composer, after postclaw's.
 *
 * Enter sends; Shift+Enter is a newline; the box grows to a few lines. Typing
 * `/` at the start opens AnyLearn's commands; `@` opens the conversation's
 * documents, and a picked one becomes a chip this question reads from. The
 * paperclip, or a file dropped anywhere on the page, attaches a photo (the
 * question goes to Solve) or adds a file to the conversation's knowledge base.
 * The mic writes a spoken question into the box.
 *
 * While a turn runs, Enter queues the message instead (up to MAX_QUEUED,
 * text only): the dock above the box lists them, and the page sends them as
 * answers finish. A failure or a stop pauses the dock with the reason.
 *
 * The draft is kept per conversation in this browser (`draftKey`).
 *
 * With "write my own version first" on (up-methods phase 11), three lines sit
 * above the message and Send waits until all three are written. Queueing is
 * off then: the three lines belong to one question at a time.
 *
 * Below the box: attach, the model chip, the context meter, the keyboard hint.
 */
export function Composer({
  onSend,
  busy,
  disabled,
  disabledReason,
  onStop,
  ownVersionFirst = false,
  draftKey,
  queued = [],
  onQueue,
  onUnqueue,
  queuePaused = null,
  onResume,
  models,
  model,
  onModel,
  modelPending = false,
  modelFailed = false,
  context,
  documents = [],
  uploadKB = null,
  onHelp,
  onUploaded,
}: {
  onSend: (message: string, ownVersion?: OwnVersion, extra?: SendExtra) => void;
  onStop?: () => void;
  busy: boolean;
  disabled?: boolean;
  disabledReason?: string;
  /** The learner's "write my own version first" switch. */
  ownVersionFirst?: boolean;
  /** Where the draft is kept; no key keeps none. */
  draftKey?: string;
  /** Messages waiting behind the running turn. */
  queued?: string[];
  onQueue?: (message: string) => void;
  onUnqueue?: (index: number) => void;
  queuePaused?: "stopped" | "failed" | null;
  onResume?: () => void;
  /** The chat route's connections; none hides the chip. */
  models?: ModelOption[];
  /** The pinned entry's modelKey, or "" for the route's own order. */
  model?: string;
  onModel?: (key: string) => void;
  modelPending?: boolean;
  modelFailed?: boolean;
  /** The last question's prompt against the model's window. */
  context?: { used: number; window: number; budget?: number; cached?: number } | null;
  /** The documents of the conversation's knowledge bases, for `@`. */
  documents?: Reference[];
  /** Where an attached file goes, or null when the conversation reads none. */
  uploadKB?: { id: string; name: string } | null;
  /** Opens the keyboard shortcuts. */
  onHelp?: () => void;
  /** A file reached the knowledge base: the page re-reads its documents. */
  onUploaded?: () => void;
}) {
  const { t } = useTranslation("common");
  const { t: tOwn } = useTranslation("ownversion");
  const [value, setValue] = useState("");
  const [caret, setCaret] = useState(0);
  const [own, setOwn] = useState<OwnVersion>(emptyOwnVersion);
  const [references, setReferences] = useState<Reference[]>([]);
  const [photo, setPhoto] = useState<PhotoAttachment | null>(null);
  const [uploads, setUploads] = useState<UploadChip[]>([]);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [restoreCaret, setRestoreCaret] = useState<number | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const menuId = useId();
  const ownReady = !ownVersionFirst || ownVersionComplete(own);
  const plain = references.length === 0 && !photo;
  const canQueue = busy && !!onQueue && !ownVersionFirst && plain && queued.length < MAX_QUEUED;

  // The draft: read once the page is in a browser, written on every change.
  useEffect(() => {
    if (!draftKey) return;
    try {
      const saved = window.localStorage.getItem(draftKey);
      if (saved) setValue(saved);
    } catch {
      // Storage refused (private mode, quota): the draft is just not kept.
    }
  }, [draftKey]);

  function change(next: string, at = next.length) {
    setValue(next);
    setCaret(at);
    if (!draftKey) return;
    try {
      if (next === "") window.localStorage.removeItem(draftKey);
      else window.localStorage.setItem(draftKey, next);
    } catch {
      // As above.
    }
  }

  // Grow with the text, to MAX_HEIGHT, then scroll inside.
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    box.style.height = "auto";
    // scrollHeight leaves out the border, which a border-box height includes;
    // without it the box is two pixels short and shows a scrollbar.
    const full = box.scrollHeight + box.offsetHeight - box.clientHeight;
    box.style.height = `${Math.min(full, MAX_HEIGHT)}px`;
    box.style.overflowY = full > MAX_HEIGHT ? "auto" : "hidden";
  }, [value]);

  // ---- the `/` and `@` menu --------------------------------------------------

  const commandLabel = (c: SlashCommand) => t(`chat.slash.command.${c.id}.label`);
  const menu: Menu | null = useMemo(() => {
    if (dismissed === value) return null;
    const slash = slashQuery(value);
    if (slash !== null && caret === value.length) return { kind: "slash", query: slash };
    const mention = documents.length > 0 ? mentionAt(value, caret) : null;
    if (mention) return { kind: "mention", ...mention };
    return null;
  }, [value, caret, dismissed, documents.length]);

  const items: TriggerItem[] = useMemo(() => {
    if (!menu) return [];
    if (menu.kind === "slash") {
      return matchCommands(menu.query, commandLabel).map((c) => ({
        key: c.id,
        label: `/${c.id}`,
        detail: `${commandLabel(c)} · ${t(`chat.slash.command.${c.id}.detail`)}`,
      }));
    }
    const q = fold(menu.query);
    const taken = new Set(references.map((r) => r.id));
    // A word of the title starting with what was typed ranks first.
    const rank = (title: string) => {
      const f = fold(title);
      if (q === "" || f.split(/[^\p{L}\p{N}]+/u).some((w) => w.startsWith(q))) return 0;
      return f.includes(q) ? 1 : 2;
    };
    return documents
      .filter((d) => !taken.has(d.id))
      .map((d) => ({ d, r: rank(d.title) }))
      .filter((x) => x.r < 2)
      .sort((a, b) => a.r - b.r)
      .map((x) => x.d)
      .slice(0, MENU_DOCUMENTS)
      .map((d) => ({ key: d.id, label: d.title, icon: <FileText aria-hidden="true" className="size-3.5 shrink-0 text-deco" /> }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, documents, references, t]);

  useEffect(() => setActive(0), [menu?.kind, menu?.query]);

  function pick(i: number) {
    const item = items[i];
    if (!menu || !item) return;
    if (menu.kind === "slash") {
      const next = `/${item.key} `;
      change(next);
    } else {
      if (references.length < MAX_REFERENCES) {
        const doc = documents.find((d) => d.id === item.key);
        if (doc) setReferences((r) => [...r, doc]);
      }
      const next = dropMention(value, menu.start, caret);
      change(next, menu.start);
    }
    setRestoreCaret(menu.kind === "slash" ? `/${item.key} `.length : menu.start);
  }

  // Where the caret goes after a pick, set in the same commit as the new text
  // so typing goes on from there.
  useLayoutEffect(() => {
    const box = ref.current;
    if (restoreCaret === null || !box) return;
    box.focus();
    box.setSelectionRange(restoreCaret, restoreCaret);
    setRestoreCaret(null);
  }, [restoreCaret, value]);

  // ---- attachments ------------------------------------------------------------

  const [waiting, setWaiting] = useState<{ key: string; file: File }[]>([]);
  const sending = useRef(false);

  // One upload at a time, through the knowledge base's streaming route; a
  // plain fetch, so the composer needs no router of its own.
  useEffect(() => {
    if (sending.current || waiting.length === 0 || !uploadKB) return;
    const [next, ...rest] = waiting;
    setWaiting(rest);
    sending.current = true;
    const data = new FormData();
    data.set("intent", "upload");
    data.append("file", next!.file, next!.file.name);
    const settle = (status: "done" | "failed", error?: string) => {
      sending.current = false;
      setUploads((list) => list.map((u) => (u.key === next!.key ? { ...u, status, error } : u)));
      onUploaded?.();
    };
    fetch(uploadAction(uploadKB.id, next!.file.name), { method: "POST", credentials: "same-origin", body: data })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { uploaded?: string; uploadErrorDetail?: string };
        if (res.ok && "uploaded" in body) settle("done");
        else settle("failed", body.uploadErrorDetail);
      })
      .catch(() => settle("failed"));
  }, [waiting, uploadKB, onUploaded]);

  async function attach(files: File[]) {
    const photos = files.filter(isPhotoFile);
    const others = files.filter((f) => !isPhotoFile(f));
    if (photos[0]) {
      const ready = await preparePhoto(photos[0]);
      if (ready.size > MAX_PHOTO_BYTES) {
        setUploads((list) => [...list, { key: crypto.randomUUID(), name: ready.name, kb: "", status: "failed", error: t("chat.attach.photoTooLarge") }]);
      } else {
        setPhoto((old) => {
          if (old) URL.revokeObjectURL(old.url);
          return { file: ready, url: URL.createObjectURL(ready) };
        });
      }
    }
    if (others.length === 0) return;
    if (!uploadKB) {
      setUploads((list) => [
        ...list,
        ...others.map((f) => ({ key: crypto.randomUUID(), name: f.name, kb: "", status: "failed" as const, error: t("chat.attach.noKnowledge") })),
      ]);
      return;
    }
    const added = others.map((file) => ({ key: crypto.randomUUID(), file }));
    setUploads((list) => [...list, ...added.map((a) => ({ key: a.key, name: a.file.name, kb: uploadKB.name, status: "uploading" as const }))]);
    setWaiting((w) => [...w, ...added]);
  }

  useEffect(() => () => {
    if (photo) URL.revokeObjectURL(photo.url);
    // Only on unmount; a replaced photo revokes its own URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dropping = useFileDrop((files) => void attach(files), !disabled);

  // ---- sending ------------------------------------------------------------------

  function send() {
    const message = value.trim();
    if ((!message && !photo) || disabled || !ownReady) return;
    if (busy) {
      if (!canQueue || !message) return;
      onQueue?.(message);
      change("");
      return;
    }
    const extra: SendExtra = {};
    if (references.length > 0) extra.references = references;
    if (photo) extra.photo = photo.file;
    if (ownVersionFirst) {
      onSend(message, { understanding: own.understanding.trim(), uncertain: own.uncertain.trim(), proof: own.proof.trim() }, extra);
      setOwn(emptyOwnVersion);
    } else {
      onSend(message, undefined, extra);
    }
    change("");
    setReferences([]);
    if (photo) {
      URL.revokeObjectURL(photo.url);
      setPhoto(null);
    }
    ref.current?.focus();
  }

  function insertSpoken(text: string) {
    if (!text) return;
    const next = value.trim() === "" ? text : `${value.replace(/\s+$/, "")} ${text}`;
    change(next);
    ref.current?.focus();
  }

  const menuOpen = !!menu && (items.length > 0 || menu.kind === "slash");
  const empty = (!value.trim() && !photo) || !ownReady;
  const sendDisabled = (busy && !canQueue) || disabled || empty;

  return (
    // Up's page under a sticky composer: the page background (so the answer
    // scrolling under it is hidden) with no rule of its own, the box drawn as
    // the search field (I4) at radius 8, the send button inside it.
    <div className="bg-background pb-[env(safe-area-inset-bottom)]">
      <DropOverlay show={dropping} kb={uploadKB?.name} />
      <div className="mx-auto max-w-(--lp-measure-read) pt-2 pb-3">
        {disabled && disabledReason && (
          <p role="status" className="mb-2 text-xs leading-ui text-muted-foreground">
            {disabledReason}
          </p>
        )}

        <QueueDock items={queued} onRemove={onUnqueue} paused={queuePaused} onResume={onResume} />

        {ownVersionFirst && (
          <div className="mb-3">
            <OwnVersionFields value={own} onChange={setOwn} disabled={disabled} idPrefix="lp-composer-own" />
            {!ownReady && value.trim() !== "" ? (
              <p role="status" className="mt-2 text-xs leading-ui text-muted-foreground">
                {tOwn("fields.required")}
              </p>
            ) : null}
          </div>
        )}

        <AttachmentRail
          references={references}
          onRemoveReference={(id) => setReferences((r) => r.filter((x) => x.id !== id))}
          photo={photo}
          onRemovePhoto={() => {
            if (photo) URL.revokeObjectURL(photo.url);
            setPhoto(null);
          }}
          uploads={uploads}
          onDismissUpload={(key) => setUploads((list) => list.filter((u) => u.key !== key))}
        />

        <div className="relative">
          {menuOpen && menu ? (
            <TriggerMenu
              id={menuId}
              label={menu.kind === "slash" ? t("chat.slash.menu") : t("chat.mention.menu")}
              items={items}
              active={active}
              empty={menu.kind === "slash" ? t("chat.slash.none") : t("chat.mention.none")}
              onPick={pick}
              onHover={setActive}
            />
          ) : null}
          <div className="flex items-end gap-1 rounded-lg border border-control-border bg-card py-1 pr-1 pl-3 transition-colors focus-within:border-primary focus-within:ring-1 focus-within:ring-primary hover:border-primary">
            <label htmlFor="lp-composer" className="sr-only">
              {t("chat.composerLabel")}
            </label>
            <textarea
              id="lp-composer"
              ref={ref}
              rows={1}
              value={value}
              disabled={disabled}
              role="combobox"
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? menuId : undefined}
              aria-autocomplete="list"
              aria-activedescendant={menuOpen && items.length > 0 ? optionId(menuId, active) : undefined}
              onChange={(e) => change(e.target.value, e.target.selectionStart ?? e.target.value.length)}
              onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (menuOpen && items.length > 0) {
                  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    const by = e.key === "ArrowDown" ? 1 : -1;
                    setActive((i) => (i + by + items.length) % items.length);
                    return;
                  }
                  if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
                    e.preventDefault();
                    pick(active);
                    return;
                  }
                }
                if (menuOpen && e.key === "Escape") {
                  // The menu owns Escape: it never stops the answer.
                  e.preventDefault();
                  e.stopPropagation();
                  setDismissed(value);
                  return;
                }
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={busy && canQueue ? t("chat.queue.placeholder") : t("chat.placeholder")}
              // The ring is the box's: focus-within turns its border to the
              // action ink, as VitePress's search field does.
              className={
                "min-h-8 flex-1 resize-none bg-transparent py-1 text-base leading-6 text-foreground " +
                "placeholder:text-faint focus-visible:outline-none disabled:opacity-50"
              }
            />

            <MicButton onText={insertSpoken} disabled={disabled} />

            {busy && onStop && value.trim() === "" ? (
              <Button type="button" variant="outline" size="icon" className="size-8 shrink-0 rounded-sm p-0" onClick={onStop}>
                <Square aria-hidden="true" />
                <span className="sr-only">{t("chat.stop")}</span>
              </Button>
            ) : (
              <Button type="button" size="icon" className="size-8 shrink-0 rounded-sm p-0" onClick={send} disabled={sendDisabled}>
                <Send aria-hidden="true" />
                <span className="sr-only">{busy ? t("chat.queue.add") : t("chat.send")}</span>
              </Button>
            )}
          </div>
        </div>

        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <div className="flex min-w-0 items-center gap-1">
            <AttachButton onFiles={(files) => void attach(files)} disabled={disabled} />
            {models && models.length > 0 && onModel ? (
              <ModelChip
                models={models}
                value={model ?? ""}
                onChange={onModel}
                pending={modelPending}
                failed={modelFailed}
                disabled={busy}
              />
            ) : null}
            {context ? <ContextMeter used={context.used} window={context.window} budget={context.budget} cached={context.cached} /> : null}
          </div>
          <p className="hidden shrink-0 items-center gap-2 text-xs leading-ui text-muted-foreground sm:flex">
            {busy && onStop ? t("chat.hintBusy") : t("chat.hint")}
            {onHelp ? (
              <button type="button" onClick={onHelp} className="rounded-sm font-medium hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                {t("chat.shortcuts.open")}
              </button>
            ) : null}
          </p>
        </div>
      </div>
    </div>
  );
}
