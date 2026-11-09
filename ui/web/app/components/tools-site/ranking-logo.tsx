import { useState } from "react";
import { cn } from "~/lib/utils";

interface RankingLogoProps {
  domain: string;
  name: string;
  size?: number;
  className?: string;
}

/**
 * Clean, lightweight brand favicon with graceful fallback to monogram.
 * Gives immediate visual recognition to software & services in rankings.
 */
export function RankingLogo({ domain, name, size = 36, className }: RankingLogoProps) {
  const [error, setError] = useState(false);
  const monogram = (name || domain).slice(0, 2).toUpperCase();

  if (error || !domain) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-md border border-border bg-muted font-mono font-bold text-muted-foreground select-none",
          className,
        )}
        style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size * 0.38)) }}
      >
        {monogram}
      </span>
    );
  }

  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=128`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setError(true)}
      className={cn(
        "inline-block shrink-0 rounded-md border border-border/60 bg-white p-1 object-contain shadow-xs",
        className,
      )}
      style={{ width: size, height: size }}
    />
  );
}
