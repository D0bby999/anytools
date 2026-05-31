import { Link } from '@/i18n/routing';
import type { BlogAuthor } from '@/lib/load-blog-content';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('');
}

export function BlogAuthorBio({ author }: { author: BlogAuthor }) {
  const href = author.url ?? '/about';
  return (
    <aside className="mt-12 not-prose rounded-lg border border-border bg-muted/30 p-5 flex gap-4">
      <div className="shrink-0">
        {author.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={author.avatarUrl}
            alt={author.name}
            width={56}
            height={56}
            className="rounded-full"
          />
        ) : (
          <div className="size-14 rounded-full bg-primary/10 text-primary flex items-center justify-center text-lg font-semibold">
            {initials(author.name)}
          </div>
        )}
      </div>
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground mb-0.5">Written by</p>
        <p className="font-semibold text-base leading-tight">
          <Link href={href} className="hover:underline">
            {author.name}
          </Link>
        </p>
        {author.credentials && (
          <p className="text-sm text-muted-foreground mt-0.5">{author.credentials}</p>
        )}
        {author.bio && <p className="text-sm mt-2 leading-relaxed">{author.bio}</p>}
        <p className="text-xs text-muted-foreground mt-3 italic">
          Edited under AnyTools editorial standards.
        </p>
      </div>
    </aside>
  );
}
