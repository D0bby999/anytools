import { cn } from "~/lib/utils";

/**
 * A provider's tile: its two letters in one of the world's part inks on that
 * part's tint (`.lp-provider-tile[data-hue]` in app.css), so forty providers
 * read apart without a brand colour that nobody measured. The hue comes from
 * the API's catalog, which spreads providers over the inks by name.
 */
export function ProviderTile({ icon, hue, size = "md" }: { icon: string; hue: string; size?: "md" | "lg" }) {
  return (
    <span
      aria-hidden="true"
      data-hue={hue}
      className={cn(
        "lp-provider-tile inline-flex shrink-0 items-center justify-center rounded-md border font-mono font-semibold",
        size === "lg" ? "size-12 text-base" : "size-9 text-xs",
      )}
    >
      {icon}
    </span>
  );
}
