import type { ReactNode } from "react";

/**
 * The block that ends a chapter, up's `afterword-closing`: centred between
 * two hairlines, a theme line in the action ink, a quiet sign-off.
 */
export function Closing({ theme, children, signoff }: { theme?: ReactNode; children?: ReactNode; signoff?: ReactNode }) {
  return (
    <aside className="lp-closing">
      {theme ? <p className="lp-closing-theme">{theme}</p> : null}
      {children}
      {signoff ? <p className="lp-closing-signoff">{signoff}</p> : null}
    </aside>
  );
}
