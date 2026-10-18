import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import type { Source } from "~/hooks/use-turn-stream";
import { formatClock } from "~/lib/kb-types";

/**
 * A citation chip.
 *
 * It is a LINK, always, and it goes to the page the passage came from —
 * `documents/:id?page=N`. That is AC1's second half: "a citation that opens the
 * page containing the quoted text". A chip that only displayed a title would
 * look like a citation and prove nothing, which is the failure this product is
 * built against.
 *
 * A source with no document id is rendered as plain text rather than a dead
 * link: a link that goes nowhere is worse than an obvious absence.
 *
 * A video passage (learning-depth phase 4) carries `seconds`, taken from the
 * document's timeline by the server, never from the model: the chip reads
 * `Title · 12:34` and opens the player there. A passage from an AI transcript
 * says so, because it may have misheard.
 *
 * A passage of a repository's code file (up-methods phase 18) carries
 * `line_end`: the chip reads `path · lines 40-72` and opens the file, which
 * the viewer shows whole.
  *
 * A spreadsheet passage carries its sheet, read by the server from the
 * heading the local reader wrote: the chip reads `Title · Sheet: Budget, p. 2`,
 * because "page 2" of a workbook means nothing until it says which sheet.
 *
 * A passage read from a photo (up-methods phase 16) says so, with the model
 * that read it, because a model can misread a page: its title carries "read
 * by <model> from a photo" and the chip a short "from a photo".
 */
export function CitationChip({ source, index }: { source: Source; index: number }) {
  const { t } = useTranslation("knowledge");
  const label = source.title ?? source.id;
  const page = source.page && source.page > 0 ? source.page : undefined;
  const seconds =
    typeof source.seconds === "number" && Number.isFinite(source.seconds) && source.seconds >= 0
      ? Math.floor(source.seconds)
      : undefined;
  const clock = seconds !== undefined ? formatClock(seconds) : undefined;
  const lines =
    page !== undefined && typeof source.line_end === "number" && source.line_end >= page
      ? t("sources.lines", { start: page, end: source.line_end })
      : undefined;
  const sheet =
    page !== undefined && source.sheet ? t("sheetSource.where", { name: source.sheet, page }) : undefined;
  const photoBy = source.photo_model ? t("photos.readBy", { model: source.photo_model }) : undefined;

  const inner = (
    <>
      <span aria-hidden="true" className="font-mono text-2xs">
        {index}
      </span>
      <span className="truncate">{label}</span>
      {clock !== undefined ? (
        <span className="shrink-0 text-muted-foreground">· {clock}</span>
      ) : lines !== undefined ? (
        <span className="shrink-0 text-muted-foreground">· {lines}</span>
      ) : sheet !== undefined ? (
        <span className="shrink-0 text-muted-foreground">· {sheet}</span>
      ) : page !== undefined ? (
        <span className="shrink-0 text-muted-foreground">p.{page}</span>
      ) : null}
      {source.ai_transcript ? (
        <span className="text-xs font-semibold shrink-0 text-faint">{t("source.aiTranscript")}</span>
      ) : null}
      {photoBy ? (
        <span className="text-xs font-semibold shrink-0 text-faint">
          {t("photos.readByShort")}
        </span>
      ) : null}
    </>
  );

  const shape =
    "inline-flex max-w-full items-baseline gap-1.5 rounded-full border px-2 py-0.5 " +
    "align-baseline text-xs leading-ui";

  // A web source (phase 9's research) opens the page it was gathered from, in
  // a new tab, with no referrer and no opener: the page is a third party's, and
  // it must not learn which report cited it or get a handle on this window.
  // Only http(s) — the server already refuses anything else, and this is the
  // second line, because a `javascript:` href here would be script in the page.
  const webURL = source.kind === "url" ? safeWebURL(source.url) : null;
  if (webURL) {
    const host = new URL(webURL).hostname;
    return (
      <a
        href={webURL}
        target="_blank"
        rel="noopener noreferrer nofollow"
        referrerPolicy="no-referrer"
        aria-label={`Open ${label} (${host}) in a new tab`}
        title={`${label} · ${host}`}
        className={
          shape +
          " border-control-border bg-card text-foreground transition-colors " +
          "hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 " +
          "focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        }
      >
        <span aria-hidden="true" className="font-mono text-2xs">
          {index}
        </span>
        <span className="truncate">{label}</span>
        <span className="shrink-0 text-muted-foreground">{host}</span>
      </a>
    );
  }

  if (!source.document_id) {
    return (
      <span className={shape + " bg-sunken text-muted-foreground"} title={label}>
        {inner}
      </span>
    );
  }

  const params = new URLSearchParams();
  if (page !== undefined && lines === undefined) params.set("page", String(page));
  if (seconds !== undefined) params.set("t", String(seconds));
  const query = params.toString();
  const href = `/documents/${source.document_id}${query ? `?${query}` : ""}`;
  const where =
    clock !== undefined
      ? ` at ${clock}`
      : lines !== undefined
        ? `, ${lines}`
        : sheet !== undefined
          ? `, ${sheet}`
          : page !== undefined
            ? `, page ${page}`
            : "";
  const aiNote =
    (source.ai_transcript ? ` (${t("source.aiTranscript")})` : "") + (photoBy ? ` (${photoBy})` : "");

  return (
    <Link
      to={href}
      // The full reference is in the accessible name, because the visible chip
      // truncates and a screen reader user gets one shot at knowing what they
      // are about to open.
      aria-label={`Open ${label}${where}${aiNote}`}
      title={`${label}${
        clock !== undefined
          ? ` · ${clock}`
          : lines !== undefined
            ? ` · ${lines}`
            : sheet !== undefined
              ? ` · ${sheet}`
              : page !== undefined
                ? ` · page ${page}`
                : ""
      }${aiNote}`}
      className={
        shape +
        " border-control-border bg-card text-foreground transition-colors " +
        "hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 " +
        "focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      }
    >
      {inner}
    </Link>
  );
}

/** The URL if it is an absolute http(s) URL, else null. */
export function safeWebURL(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}
