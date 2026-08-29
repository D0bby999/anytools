import type { BlogHeroImage } from '@/lib/load-blog-content';
import { UnsplashCredit } from './unsplash-credit';

type BlogHeroProps = {
  image: BlogHeroImage;
};

export function BlogHero({ image }: BlogHeroProps) {
  // PostClaw-ingested rows store heroImage as { url, alt } with no credit block
  // (map-postclaw-payload.ts) — the caption only exists when there is someone
  // to credit: a photographer, or an AI hero with a source worth citing.
  const credit = image.credit;
  const showCredit = credit != null && (credit.kind === 'ai' || Boolean(credit.photographer));
  return (
    <figure className="mb-8 not-prose">
      {/* External s3cloud.vn host — plain img tag avoids Next.js Image domain config */}
      {/* biome-ignore lint/performance/noImgElement: external CDN, Cloudflare cache handles */}
      <img
        src={image.url}
        alt={image.alt}
        className="w-full aspect-[16/9] object-cover rounded-lg"
      />
      {showCredit && (
        <figcaption className="mt-2 text-xs text-muted-foreground">
          <UnsplashCredit credit={credit} />
        </figcaption>
      )}
    </figure>
  );
}
