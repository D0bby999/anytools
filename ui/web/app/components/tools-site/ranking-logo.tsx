import { useState } from "react";
import { cn } from "~/lib/utils";
import { TOOL_LOGOS } from "~/lib/tools/rankings";

interface RankingLogoProps {
  domain: string;
  name: string;
  logo?: string;
  size?: number;
  className?: string;
}

/**
 * Self-hosted brand logo with local assets first,
 * graceful fallback to monogram badge (CSP-safe, no remote tracking).
 */
export function RankingLogo({ domain, name, logo, size = 36, className }: RankingLogoProps) {
  const cleanDomain = (domain || "").trim().toLowerCase().replace(/^www\./, "");
  const monogram = (name || cleanDomain || "?").slice(0, 2).toUpperCase();

  const candidates = [
    logo,
    cleanDomain ? TOOL_LOGOS[cleanDomain] : undefined,
  ].filter((src, idx, arr): src is string => Boolean(src) && arr.indexOf(src) === idx);

  const key = `${cleanDomain}|${logo ?? ""}`;
  const [state, setState] = useState<{ key: string; index: number }>({ key, index: 0 });
  const activeIndex = state.key === key ? state.index : 0;
  const resolvedSrc = candidates[activeIndex] ?? null;

  const advanceFallback = () => {
    setState((prev) => ({
      key,
      index: (prev.key === key ? prev.index : 0) + 1,
    }));
  };

  if (!resolvedSrc) {
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
      key={`${key}-${activeIndex}`}
      ref={(img) => {
        if (img && img.complete && img.naturalWidth === 0) {
          advanceFallback();
        }
      }}
      src={resolvedSrc}
      alt={`${name} logo`}
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={advanceFallback}
      className={cn(
        "inline-block shrink-0 rounded-md border border-border/60 bg-card p-1 object-contain",
        className,
      )}
      style={{ width: size, height: size }}
    />
  );
}
