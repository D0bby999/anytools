import { cn } from "~/lib/utils";

/**
 * The site's illustrations: textbook plates, pen and ink with flat washes in
 * the parts' colours (public/plates, each with its prompt beside it as JSON).
 * They are decoration, so the alt text is empty: every one sits beside words
 * that already say what it shows.
 */
export const PLATES = [
  "hero-study",
  "part-read",
  "part-ask",
  "part-practise",
  "part-reflect",
  "tools-hero",
  "guides",
  "about",
  "signin",
  "notfound",
  "postclaw",
] as const;
export type PlateName = (typeof PLATES)[number];

/**
 * One plate, at 600 or 1200 pixels wide as the layout needs (`sizes`). Its
 * paper was made transparent, so on a light page only the drawing shows; in
 * dark mode `lp-plate` prints it on its own paper (app.css).
 *
 * `priority` is for the one plate in a first viewport: fetched early, never
 * lazily.
 */
export function Plate({
  name,
  sizes = "(min-width: 1024px) 40vw, 100vw",
  priority = false,
  className,
}: {
  name: PlateName;
  sizes?: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <img
      src={`/plates/${name}.webp`}
      srcSet={`/plates/${name}-sm.webp 600w, /plates/${name}.webp 1200w`}
      sizes={sizes}
      width={1200}
      height={800}
      alt=""
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      draggable={false}
      className={cn("lp-plate h-auto w-full select-none", className)}
    />
  );
}

/**
 * A page with nothing in it yet: the part's plate over the sentence that says
 * what to do. Only for a page's first-run state; an empty list inside a busy
 * page stays a plain `lp-empty` line.
 */
export function PlateEmpty({ name, className, children }: { name: PlateName; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("grid items-center gap-x-8 gap-y-2 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]", className)}>
      <Plate name={name} sizes="(min-width: 640px) 15rem, 60vw" className="max-w-60" />
      <div className="lp-empty">{children}</div>
    </div>
  );
}
