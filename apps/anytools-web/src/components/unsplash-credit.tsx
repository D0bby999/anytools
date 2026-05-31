import type { UnsplashCredit as UnsplashCreditData } from '@/lib/load-blog-content';

type UnsplashCreditProps = {
  credit: UnsplashCreditData;
};

// Per Unsplash ToS: credit MUST link to photographer profile + Unsplash with utm tags.
// Render under every blog hero image.
export function UnsplashCredit({ credit }: UnsplashCreditProps) {
  return (
    <>
      Photo by{' '}
      <a
        href={credit.photographer_url}
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-foreground"
      >
        {credit.photographer}
      </a>{' '}
      on{' '}
      <a
        href={credit.unsplash_url}
        target="_blank"
        rel="noopener noreferrer"
        className="underline hover:text-foreground"
      >
        Unsplash
      </a>
    </>
  );
}
