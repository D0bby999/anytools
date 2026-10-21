/**
 * share.ts
 * The link in a share (the private design notes, phase 4). Android
 * hands the installed app what was shared as `title`, `text` and `url`; most
 * apps put the link in `url`, YouTube and many others in `text`, after a
 * sentence. Only http and https links are taken: AnyLearn adds web pages,
 * videos and feeds, nothing else.
 */

const LINK = /https?:\/\/[^\s<>"']+/gi;

/** The link, trimmed of the punctuation a sentence leaves after it; null when there is none. */
export function pickLink(shared: { title?: string | null; text?: string | null; url?: string | null }): string | null {
  for (const field of [shared.url, shared.text, shared.title]) {
    for (const match of (field ?? "").matchAll(LINK)) {
      const candidate = match[0].replace(/[.,;:!?)\]}»”’]+$/u, "");
      try {
        const u = new URL(candidate);
        if ((u.protocol === "http:" || u.protocol === "https:") && u.hostname.includes(".")) return u.toString();
      } catch {
        // Not a URL after all; look on.
      }
    }
  }
  return null;
}

/** The shared title, unless it is only the link again. */
export function sharedTitle(shared: { title?: string | null; text?: string | null }, link: string | null): string {
  const title = (shared.title ?? "").trim();
  if (title && title !== link) return title;
  const text = (shared.text ?? "").replace(LINK, "").trim();
  return text.length > 0 && text.length <= 200 ? text : "";
}
