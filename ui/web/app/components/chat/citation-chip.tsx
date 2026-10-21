import type { ReactNode } from "react";
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
 *
 * Since the up shell (plan 261020-2246, phase 09) a citation in running text
 * is a superscript number in the action ink, as a footnote reference in a
 * book: the claim reads on without a pill breaking the line, and the number is
 * the one the Sources list beside the answer gives the passage. The full
 * reference stays in the link's accessible name and title, and in a visually
 * hidden span, so nothing a reader of the old chip learned is lost. A list of
 * sources (`variant="entry"`) shows the reference whole: number · title — where.
 */
export function CitationChip({
  source,
  index,
  variant = "inline",
}: {
  source: Source;
  index: number;
  /** `inline`: a superscript number in prose. `entry`: one line of a sources list. */
  variant?: "inline" | "entry";
}) {
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

  const entry = variant === "entry";
  const details = (
    <>
      <span className={entry ? "min-w-0 truncate" : undefined}>{label}</span>
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
  const inner = framed(index, details, entry);

  // A web source (phase 9's research) opens the page it was gathered from, in
  // a new tab, with no referrer and no opener: the page is a third party's, and
  // it must not learn which report cited it or get a handle on this window.
  // Only http(s) — the server already refuses anything else, and this is the
  // second line, because a `javascript:` href here would be script in the page.
  const webURL = source.kind === "url" ? safeWebURL(source.url) : null;
  if (webURL) {
    const host = new URL(webURL).hostname;
    const link = (
      <a
        href={webURL}
        target="_blank"
        rel="noopener noreferrer nofollow"
        referrerPolicy="no-referrer"
        aria-label={`${index}: Open ${label} (${host}) in a new tab`}
        title={`${label} · ${host}`}
        className={entry ? ENTRY_LINK : INLINE_LINK}
      >
        {framed(
          index,
          <>
            <span className={entry ? "min-w-0 truncate" : undefined}>{label}</span>
            <span className="shrink-0 text-muted-foreground">{host}</span>
          </>,
          entry,
        )}
      </a>
    );
    return entry ? link : <sup className="lp-cite-ref">{link}</sup>;
  }

  if (!source.document_id) {
    const text = (
      <span className={entry ? ENTRY_SHAPE + " text-muted-foreground" : "text-muted-foreground"} title={label}>
        {inner}
      </span>
    );
    return entry ? text : <sup className="lp-cite-ref">{text}</sup>;
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

  const link = (
    <Link
      to={href}
      // The full reference is in the accessible name, because the visible chip
      // truncates and a screen reader user gets one shot at knowing what they
      // are about to open. It starts with the number on screen, so a voice
      // user saying "click 1" reaches it (WCAG 2.5.3, label in name).
      aria-label={`${index}: Open ${label}${where}${aiNote}`}
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
      className={entry ? ENTRY_LINK : INLINE_LINK}
    >
      {inner}
    </Link>
  );
  return entry ? link : <sup className="lp-cite-ref">{link}</sup>;
}

/**
 * The number and the reference. Inline, only the number shows and the rest is
 * read by a screen reader and kept in the text; as an entry, the whole line
 * shows, joined the way up's dated lists are: number · title — where.
 */
function framed(index: number, details: ReactNode, entry: boolean) {
  if (!entry) {
    return (
      <>
        <span aria-hidden="true">{index}</span>
        <span className="sr-only">{details}</span>
      </>
    );
  }
  return (
    <>
      <span aria-hidden="true" className="shrink-0 tabular-nums">
        {index}
      </span>
      <span aria-hidden="true" className="shrink-0 text-muted-foreground">
        ·
      </span>
      {details}
    </>
  );
}

// The `!` utilities win over the prose rules the citation sits inside
// (`.lp-prose .lp-chip a` sets the body ink and no underline).
const INLINE_LINK =
  "ml-px rounded-[4px] px-px font-medium text-primary! no-underline! transition-colors " +
  "hover:text-primary-hover! hover:underline! focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";
const ENTRY_SHAPE = "inline-flex max-w-full items-baseline gap-2 text-sm leading-6";
const ENTRY_LINK =
  ENTRY_SHAPE +
  " text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

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
