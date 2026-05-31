import { Link } from '@/i18n/routing';
import type { BlogFrontmatter } from '@/lib/load-blog-content';
import { Card, CardDescription, CardHeader, CardTitle } from '@anytools/ui';

type BlogCardProps = {
  slug: string;
  data: BlogFrontmatter;
};

export function BlogCard({ slug, data }: BlogCardProps) {
  return (
    <Link href={`/blog/${slug}` as never} className="block group">
      <Card className="hover:border-primary transition-colors overflow-hidden">
        {data.heroImage?.url && (
          // External s3cloud.vn host — plain img tag avoids Next.js Image domain config
          // biome-ignore lint/performance/noImgElement: external CDN, Cloudflare cache handles
          <img
            src={data.heroImage.url}
            alt={data.heroImage.alt}
            loading="lazy"
            className="w-full aspect-[16/9] object-cover"
          />
        )}
        <CardHeader>
          {data.category && (
            <p className="text-xs uppercase tracking-wide text-accent font-medium mb-1">
              {data.category}
            </p>
          )}
          <CardTitle>{data.title}</CardTitle>
          {data.description && <CardDescription>{data.description}</CardDescription>}
          {data.readingTime && (
            <p className="text-xs text-muted-foreground mt-2">{data.readingTime} min read</p>
          )}
        </CardHeader>
      </Card>
    </Link>
  );
}
