import type { UnsplashCredit as UnsplashCreditData } from '@/lib/load-blog-content';

type UnsplashCreditProps = {
  credit: UnsplashCreditData;
};

// Per Unsplash ToS: credit MUST link to photographer profile + Unsplash with utm tags.
// Render under every blog hero image.
export function UnsplashCredit({ credit }: UnsplashCreditProps) {
  // PostClaw-ingested heroes carry kind='ai' and no photographer_url/unsplash_url
  // (map-postclaw-payload.ts) — the Unsplash attribution copy below doesn't apply.
  if (credit.kind === 'ai') {
    return (
      <>
        {credit.source_label ?? 'AI illustration'}
        {credit.source_url && (
          <>
            {' · '}
            <a
              href={credit.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              reference
            </a>
          </>
        )}
      </>
    );
  }
  return (
    <>
      Photo by{' '}
      <a
        href={credit.photographer_url ?? '#'}
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-foreground"
      >
        {credit.photographer}
      </a>{' '}
      on{' '}
      <a
        href={credit.unsplash_url ?? '#'}
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-foreground"
      >
        {credit.source_label ?? 'Unsplash'}
      </a>
    </>
  );
}
