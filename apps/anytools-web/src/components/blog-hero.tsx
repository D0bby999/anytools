import type { BlogHeroImage } from '@/lib/load-blog-content';
import { UnsplashCredit } from './unsplash-credit';

type BlogHeroProps = {
  image: BlogHeroImage;
};

export function BlogHero({ image }: BlogHeroProps) {
  return (
    <figure className="mb-8 not-prose">
      {/* External s3cloud.vn host — plain img tag avoids Next.js Image domain config */}
      {/* biome-ignore lint/performance/noImgElement: external CDN, Cloudflare cache handles */}
      <img
        src={image.url}
        alt={image.alt}
        className="w-full aspect-[16/9] object-cover rounded-lg"
      />
      <figcaption className="mt-2 text-xs text-muted-foreground">
        <UnsplashCredit credit={image.credit} />
      </figcaption>
    </figure>
  );
}
