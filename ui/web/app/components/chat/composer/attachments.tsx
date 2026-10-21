/**
 * attachments.tsx — what goes with the next question (after postclaw's
 * attachment rail, chips and drop overlay).
 *
 * Three kinds, each a chip above the text with a way to remove it:
 * - a document pointed at with `@`: this question's searches read only it;
 * - a photo: the question goes to Solve, which reads the photo;
 * - any other file: added to the conversation's knowledge base at once, so
 *   later questions can read it (the chip says where it went).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Image as ImageIcon, Paperclip, Upload, X } from "lucide-react";
import { LiveLabel } from "~/components/chat/shared/live-label";
import { ACCEPTED_EXTENSIONS, PHOTO_EXTENSIONS } from "~/lib/kb-types";
import { cn } from "~/lib/utils";

export type Reference = { id: string; title: string };
export type PhotoAttachment = { file: File; url: string };
export type UploadChip = { key: string; name: string; kb: string; status: "uploading" | "done" | "failed"; error?: string };

/** Photos go to Solve; the API takes one of up to 5 MB. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

function Chip({ icon, children, onRemove, removeLabel, tone = "default" }: {
  icon: ReactNode;
  children: ReactNode;
  onRemove?: () => void;
  removeLabel?: string;
  tone?: "default" | "error";
}) {
  return (
    <li
      className={cn(
        "flex max-w-full min-w-0 items-center gap-1.5 rounded-md border bg-card py-0.5 pr-0.5 pl-2 text-xs leading-6",
        tone === "error" && "border-destructive text-destructive",
      )}
    >
      {icon}
      <span className="min-w-0 truncate">{children}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      ) : null}
    </li>
  );
}

export function AttachmentRail({
  references,
  onRemoveReference,
  photo,
  onRemovePhoto,
  uploads,
  onDismissUpload,
}: {
  references: Reference[];
  onRemoveReference: (id: string) => void;
  photo: PhotoAttachment | null;
  onRemovePhoto: () => void;
  uploads: UploadChip[];
  onDismissUpload: (key: string) => void;
}) {
  const { t } = useTranslation("common");
  if (references.length === 0 && !photo && uploads.length === 0) return null;
  return (
    <ul aria-label={t("chat.attach.label")} className="mb-2 flex flex-wrap gap-1.5">
      {references.map((r) => (
        <Chip
          key={r.id}
          icon={<FileText aria-hidden="true" className="size-3.5 shrink-0 text-deco" />}
          onRemove={() => onRemoveReference(r.id)}
          removeLabel={t("chat.attach.removeNamed", { name: r.title })}
        >
          <span className="sr-only">{t("chat.attach.reference")} </span>
          {r.title}
        </Chip>
      ))}
      {photo ? (
        <Chip
          icon={<img src={photo.url} alt="" className="size-6 shrink-0 rounded-sm object-cover" />}
          onRemove={onRemovePhoto}
          removeLabel={t("chat.attach.removeNamed", { name: photo.file.name })}
        >
          {t("chat.attach.photo", { name: photo.file.name })}
        </Chip>
      ) : null}
      {uploads.map((u) => (
        <Chip
          key={u.key}
          tone={u.status === "failed" ? "error" : "default"}
          icon={<Upload aria-hidden="true" className="size-3.5 shrink-0 text-deco" />}
          onRemove={u.status === "uploading" ? undefined : () => onDismissUpload(u.key)}
          removeLabel={t("chat.attach.dismiss")}
        >
          {u.status === "uploading" ? (
            <LiveLabel live>{t("chat.attach.uploading", { name: u.name, kb: u.kb })}</LiveLabel>
          ) : u.status === "done"
              ? t("chat.attach.uploaded", { name: u.name, kb: u.kb })
              : t("chat.attach.uploadFailed", { name: u.name, error: u.error ?? "" })}
        </Chip>
      ))}
    </ul>
  );
}

/** The paperclip: photos and the files a knowledge base reads. */
export function AttachButton({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled?: boolean }) {
  const { t } = useTranslation("common");
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={disabled}
        aria-label={t("chat.attach.button")}
        title={t("chat.attach.button")}
        className="flex size-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
      >
        <Paperclip aria-hidden="true" className="size-4" />
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept={[...ACCEPTED_EXTENSIONS, ...PHOTO_EXTENSIONS].join(",")}
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : [];
          e.target.value = "";
          if (files.length > 0) onFiles(files);
        }}
      />
    </>
  );
}

/**
 * Files dragged over the page: a full-page overlay says where they go, and
 * dropping anywhere hands them to the composer.
 */
export function useFileDrop(onFiles: (files: File[]) => void, enabled: boolean): boolean {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const sink = useRef(onFiles);
  sink.current = onFiles;
  useEffect(() => {
    if (!enabled) return;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current++;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    };
    const overHandler = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      const files = e.dataTransfer ? Array.from(e.dataTransfer.files) : [];
      if (files.length > 0) sink.current(files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", overHandler);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", overHandler);
      window.removeEventListener("drop", drop);
    };
  }, [enabled]);
  return over;
}

export function DropOverlay({ show, kb }: { show: boolean; kb?: string }) {
  const { t } = useTranslation("common");
  if (!show) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[90] flex items-center justify-center bg-[var(--lp-backdrop)] p-6">
      <div className="flex max-w-md flex-col items-center gap-2 rounded-xl border-2 border-dashed border-primary bg-background px-8 py-6 text-center">
        <ImageIcon aria-hidden="true" className="size-6 text-primary" />
        <p className="font-serif text-lg font-semibold">{t("chat.attach.dropTitle")}</p>
        <p className="text-sm text-muted-foreground">{kb ? t("chat.attach.dropHelp", { kb }) : t("chat.attach.dropPhotoOnly")}</p>
      </div>
    </div>
  );
}
