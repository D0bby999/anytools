import { useRef, useState } from "react";
import { useFetcher } from "react-router";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, Upload } from "lucide-react";
import { cn } from "~/lib/utils";
import { ACCEPTED_EXTENSIONS, MAX_PHOTOS_PER_DOCUMENT, MAX_UPLOAD_BYTES, isPhotoFile, uploadLimit } from "~/lib/kb-types";
import { preparePhoto, type PhotoCodec } from "~/lib/image-resize";
import { driveReason } from "~/lib/drive-storage";
import { DriveFileNotice } from "~/components/storage/drive-file-notice";

/**
 * upload-dropzone.tsx
 *
 * A drop target that is also a real file input.
 *
 * The input is the control; the drop zone is an enhancement over it. Built the
 * other way round — a styled div that opens a hidden picker — the thing a
 * keyboard reaches is a div, and "upload a document" stops being reachable
 * without a mouse. Here the `<label>` wraps a genuine `<input type="file">`, so
 * focus, Enter, and screen-reader labelling all work without any ARIA.
 *
 * Up-methods phase 15: audio and video files are accepted too, up to 500 MB.
 * The form posts to the streaming upload route (knowledge.$kbId.upload.ts),
 * which pipes the body to the API instead of holding it, and a file over its
 * cap is refused here before a byte is sent.
 *
 * Up-methods phase 16: several files may be chosen at once. Each is its own
 * document (the page action sends one request per file and names each
 * failure; it holds the files, so audio and video go one at a time),
 * except that several photos can be kept as ONE document, one page per photo,
 * in the order shown here. Every photo is scaled and stripped of its location
 * in the browser first (image-resize.ts).
 */
export function UploadDropzone({ kbId, codec }: { kbId: string; codec?: PhotoCodec }) {
  const { t } = useTranslation("knowledge");
  const fetcher = useFetcher();
  const formRef = useRef<HTMLFormElement>(null);
  const [dragging, setDragging] = useState(false);
  const [tooLarge, setTooLarge] = useState<string | null>(null);
  const [oneAtATime, setOneAtATime] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  // Photos waiting for the learner to say whether they are one document.
  const [staged, setStaged] = useState<File[]>([]);
  const [together, setTogether] = useState(false);

  const busy = fetcher.state !== "idle" || preparing;
  const tooMany = together && staged.length > MAX_PHOTOS_PER_DOCUMENT;

  async function send(files: File[], oneDocument: boolean) {
    const over = files.find((f) => f.size > uploadLimit(f.name) && !isPhotoFile(f));
    if (over) {
      setTooLarge(over.name);
      return;
    }
    // Several separate files go through the page action, which holds them in
    // memory: fine at 50 MB, not for a recording.
    const media = files.length > 1 && !oneDocument ? files.find((f) => uploadLimit(f.name) > MAX_UPLOAD_BYTES) : undefined;
    if (media) {
      setTooLarge(null);
      setOneAtATime(media.name);
      return;
    }
    setTooLarge(null);
    setOneAtATime(null);
    setPreparing(true);
    let ready: File[];
    try {
      ready = await Promise.all(files.map((f) => preparePhoto(f, codec)));
    } finally {
      setPreparing(false);
    }
    const data = new FormData();
    data.set("intent", "upload");
    for (const file of ready) data.append("file", file, file.name);
    if (oneDocument) data.set("one_document", "true");
    // One file, or photos kept as one document: streamed to the API by
    // knowledge.$kbId.upload.ts. Several separate files: the page action
    // uploads each on its own.
    const single = ready.length === 1 || oneDocument;
    fetcher.submit(data, {
      method: "post",
      action: single ? uploadAction(kbId, ready[0]?.name ?? "") : `/knowledge/${encodeURIComponent(kbId)}`,
      encType: "multipart/form-data",
    });
  }

  function submitFiles(list: FileList | null) {
    const files = list ? Array.from(list) : [];
    if (files.length === 0) return;
    if (files.length > 1 && files.every(isPhotoFile)) {
      setStaged(files);
      setTogether(false);
      return;
    }
    void send(files, false);
  }

  function move(from: number, to: number) {
    setStaged((files) => {
      const next = [...files];
      const [file] = next.splice(from, 1);
      if (file) next.splice(to, 0, file);
      return next;
    });
  }

  // Kept in the learner's Google Drive, which refused the file
  // (drive-user-storage phase 3).
  const refusedBy =
    fetcher.data && typeof fetcher.data === "object"
      ? driveReason((fetcher.data as { driveReason?: unknown }).driveReason)
      : null;

  return (
    <fetcher.Form
      ref={formRef}
      method="post"
      action={uploadAction(kbId, "")}
      encType="multipart/form-data"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        submitFiles(event.dataTransfer.files);
      }}
    >
      <input type="hidden" name="intent" value="upload" />

      <label
        className={cn(
          // up's dropzone (spec, knowledge base row): a dashed 1px control
          // border, radius 8, padding 24, its words 14px in secondary ink.
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground transition-colors",
          // The control border, not the decorative hairline: this is something
          // you operate, and WCAG 1.4.11 wants 3:1 on the boundary that says so.
          "border-control-border hover:border-primary",
          dragging && "border-primary bg-primary-soft",
          busy && "pointer-events-none opacity-60",
          // The focus ring lands on the label because the input inside it is
          // visually hidden but still focusable.
          "focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2 focus-within:ring-offset-background",
        )}
      >
        <Upload aria-hidden="true" className="size-5 text-muted-foreground" />
        <span className="text-sm font-medium text-foreground">
          {preparing ? t("photos.preparing") : busy ? t("upload.uploading") : t("upload.drop")}
        </span>
        <span className="text-xs leading-snug text-muted-foreground">{t("upload.accepted")}</span>
        <span className="text-xs leading-snug text-muted-foreground">{t("media.accepted")}</span>
        <span className="text-xs leading-snug text-muted-foreground">{t("photos.accepted")}</span>

        <input
          type="file"
          name="file"
          // A hint for the picker only. The decision is the server's:
          // parse.Detect re-checks the extension AND the file's own bytes,
          // because this attribute is one devtools edit from saying anything.
          accept={ACCEPTED_EXTENSIONS.join(",")}
          multiple
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            submitFiles(event.currentTarget.files);
            // Clearing the value makes re-uploading the same filename after a
            // failure fire a change event; without it the second attempt is
            // silently ignored.
            event.currentTarget.value = "";
          }}
        />
      </label>

      {tooLarge ? (
        <p role="alert" className="mt-2 text-sm leading-snug text-destructive">
          {t("media.tooLarge", { name: tooLarge, mb: Math.round(uploadLimit(tooLarge) / (1024 * 1024)) })}
        </p>
      ) : null}
      {oneAtATime ? (
        <p role="alert" className="mt-2 text-sm leading-snug text-destructive">
          {t("media.oneAtATime", { name: oneAtATime })}
        </p>
      ) : null}
      {staged.length > 0 ? (
        <div className="mt-3 rounded-lg border px-4 py-3">
          <p className="lp-kicker">{t("photos.chosen", { count: staged.length })}</p>
          <ol className="mt-2 divide-y">
            {staged.map((file, i) => (
              <li key={`${file.name}-${i}`} className="flex min-h-11 items-center gap-3 text-sm">
                <span className="w-6 shrink-0 font-mono text-2xs text-muted-foreground">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate">{file.name}</span>
                <button
                  type="button"
                  disabled={i === 0 || busy}
                  onClick={() => move(i, i - 1)}
                  aria-label={t("photos.moveUp", { name: file.name })}
                  className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40"
                >
                  <ArrowUp aria-hidden="true" className="size-4" />
                </button>
                <button
                  type="button"
                  disabled={i === staged.length - 1 || busy}
                  onClick={() => move(i, i + 1)}
                  aria-label={t("photos.moveDown", { name: file.name })}
                  className="inline-flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40"
                >
                  <ArrowDown aria-hidden="true" className="size-4" />
                </button>
              </li>
            ))}
          </ol>
          <label className="mt-3 flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={together}
              onChange={(event) => setTogether(event.currentTarget.checked)}
              className="size-4 accent-primary"
            />
            {t("photos.together")}
          </label>
          <p className="text-xs leading-snug text-muted-foreground">{t("photos.togetherHint")}</p>
          {tooMany ? (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {t("photos.tooMany")}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || tooMany}
              onClick={() => {
                const files = staged;
                setStaged([]);
                void send(files, together);
              }}
              className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {t("photos.add")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setStaged([])}
              className="inline-flex min-h-11 items-center rounded-md border border-control-border px-4 text-sm"
            >
              {t("photos.cancel")}
            </button>
          </div>
        </div>
      ) : null}

      {fetcher.data && typeof fetcher.data === "object" && "uploadErrorKey" in fetcher.data ? (
        refusedBy ? (
          // The reason, in this app's words, with what to do about it.
          <DriveFileNotice reason={refusedBy} className="mt-2" />
        ) : (
          // The key is translated; the detail is the API's own sentence, which no
          // locale can translate because it came out of a Go binary. An upload is
          // judged by its STATUS upstream, so this renders for a 413 from a proxy
          // and an empty 500 too — both of which used to fall through as success.
          <p role="alert" className="mt-2 text-sm leading-snug text-destructive">
            {t((fetcher.data as { uploadErrorKey: string }).uploadErrorKey)}
            {(fetcher.data as { uploadErrorDetail?: string }).uploadErrorDetail
              ? ` ${(fetcher.data as { uploadErrorDetail?: string }).uploadErrorDetail}`
              : ""}
          </p>
        )
      ) : null}
    </fetcher.Form>
  );
}

/** The streaming upload route, with the file's name for its messages. */
export function uploadAction(kbId: string, filename: string): string {
  const base = `/knowledge/${encodeURIComponent(kbId)}/upload`;
  return filename ? `${base}?${new URLSearchParams({ name: filename }).toString()}` : base;
}
