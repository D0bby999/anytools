/**
 * Official manufacturer / tool-maker video embed (YouTube), rendered below the
 * post body.
 *
 * Privacy + performance: serves from youtube-nocookie.com (no tracking cookie
 * until the user hits play) with loading="lazy", so the heavy player is only
 * fetched when it scrolls near the viewport — kept off the critical path. Plain
 * server component, zero client JS. `not-prose` opts it out of the article's
 * prose typography so the player keeps its own layout.
 *
 * Content rule (enforced upstream by /do): videoId must come from the official
 * source's OWN YouTube channel — never a third-party reviewer or reupload
 * (copyright + brand safety). One video per post. The field is optional; with no
 * videoId in the frontmatter, nothing renders.
 */

type YouTubeEmbedProps = {
  /** 11-character YouTube video id (the part after watch?v=). */
  videoId: string;
  /** Optional eyebrow label; falls back to a generic watch prompt. */
  title?: string;
};

export function YouTubeEmbed({ videoId, title }: YouTubeEmbedProps) {
  if (!videoId) return null;
  const label = title?.trim() || 'Watch it in action';
  return (
    <section className="my-8 not-prose">
      <p className="text-xs uppercase tracking-wide text-accent font-medium mb-2">▶ {label}</p>
      <div className="aspect-video w-full overflow-hidden rounded-lg border border-border">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${videoId}?rel=0`}
          title={label}
          loading="lazy"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          className="size-full border-0"
        />
      </div>
    </section>
  );
}
