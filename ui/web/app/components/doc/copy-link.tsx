/**
 * copy-link.tsx
 * A button that copies an address, and a status line that says it did for a
 * few seconds (a study circle's invite, a public profile's link).
 */
import { useEffect, useState } from "react";
import { StatusLine } from "~/components/doc/status-line";
import { Button } from "~/components/ui/button";

export function CopyLink({ url, label, copiedLabel }: { url: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 3000);
    return () => clearTimeout(id);
  }, [copied]);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          void navigator.clipboard?.writeText(url).then(() => setCopied(true));
        }}
      >
        {label}
      </Button>
      <StatusLine>{copied ? copiedLabel : null}</StatusLine>
    </>
  );
}
