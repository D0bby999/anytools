import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { DocumentContent } from "~/lib/kb-types";
import { DriveFileNotice, useDriveReason } from "~/components/storage/drive-file-notice";

/**
 * The reading view of a photo document (up-methods phase 16): each page's
 * photo beside the text the model read from it, so the learner can check the
 * reading against the page.
 *
 * Pages keep `id="page-N"` and `data-page`, the anchors every citation and the
 * selection toolbar use, exactly as TextPages does. The text is shown as
 * pre-wrapped TEXT for the same reason: it is a model's reading of an upload.
 * The photo comes through the resource route, which carries the API's own
 * sandbox and nosniff headers.
 */
export function PhotoPages({
  docId,
  pages,
  onReadPage,
  readPageLabel,
}: {
  docId: string;
  pages: DocumentContent["pages"];
  onReadPage?: (text: string) => void;
  readPageLabel?: string;
}) {
  const { t } = useTranslation("knowledge");
  return (
    <article className="lp-prose">
      {(pages ?? []).map((page) => (
        <section
          key={page.page}
          id={`page-${page.page}`}
          data-page={page.page}
          aria-labelledby={`page-${page.page}-label`}
          className="scroll-mt-20 border-t py-6 first:border-t-0"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 id={`page-${page.page}-label`} className="lp-kicker">
              {page.page}
            </h2>
            {onReadPage && page.markdown ? (
              <button
                type="button"
                onClick={() => onReadPage(page.markdown)}
                className="inline-flex min-h-11 items-center text-xs text-primary underline underline-offset-4"
              >
                {readPageLabel}
              </button>
            ) : null}
          </div>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <PagePhoto docId={docId} page={page.page} />
            {page.markdown ? (
              <p className="whitespace-pre-wrap">{page.markdown}</p>
            ) : (
              <p className="text-muted-foreground">{t("viewer.empty")}</p>
            )}
          </div>
        </section>
      ))}
    </article>
  );
}

function PagePhoto({ docId, page }: { docId: string; page: number }) {
  const { t } = useTranslation("knowledge");
  const [failed, setFailed] = useState(false);
  // A photo kept in the learner's Drive says why it cannot be shown
  // (drive-user-storage phase 3).
  const [reason, checkReason] = useDriveReason();
  const src = `/documents/${encodeURIComponent(docId)}/photo?page=${page}`;
  if (failed && reason) return <DriveFileNotice reason={reason} />;
  if (failed) {
    return (
      <p role="status" className="rounded-lg border bg-sunken px-3 py-4 text-xs leading-snug text-muted-foreground">
        {t("photos.cannotShow")}
      </p>
    );
  }
  return (
    <figure className="m-0">
      <img
        src={src}
        alt={t("photos.alt", { page })}
        loading="lazy"
        onError={() => {
          setFailed(true);
          checkReason(src);
        }}
        className="h-auto w-full rounded-lg border bg-sunken"
      />
    </figure>
  );
}
