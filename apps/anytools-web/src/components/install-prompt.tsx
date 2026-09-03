'use client';

import { Button } from '@anytools/ui';
import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

/**
 * Chrome/Edge fire `beforeinstallprompt` on a page that qualifies as an installable PWA
 * (manifest + service worker + HTTPS). It is not in the DOM lib's event map, so this is the
 * minimal shape this component actually uses.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

/**
 * Renders nothing until the browser actually offers an install (`beforeinstallprompt`).
 * Firefox and Safari never fire that event, so most visitors never see this button at all
 * — that's correct, not a bug: there is no other reliable cross-browser signal that
 * installing is currently possible.
 *
 * The `null` case renders no wrapper element at all — the layout `<div>` this button sits in
 * lives HERE, not in footer.tsx, specifically so a hidden prompt adds zero DOM nodes to the
 * footer. An earlier version put that wrapper in footer.tsx around `<InstallPrompt />`; on
 * every visit where the prompt never fires (Firefox, Safari, anyone who already installed —
 * effectively 100% of visits before Chrome/Edge actually offer install), that left an empty
 * `<div>` as the footer nav's preceding sibling, adding `margin-top` to the nav on every page
 * for every visitor (review finding #13).
 */
export function InstallPrompt() {
  const t = useTranslations('footer');
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    function handleBeforeInstallPrompt(event: Event) {
      // Stop Chrome's own mini-infobar; we show our own button instead.
      event.preventDefault();
      setDeferredEvent(event as BeforeInstallPromptEvent);
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  if (!deferredEvent) return null;

  return (
    <div className="flex md:justify-end">
      <Button
        variant="outline"
        size="sm"
        className="inline-flex items-center gap-2"
        onClick={async () => {
          await deferredEvent.prompt();
          // The prompt can only be used once — whether accepted or dismissed, drop the
          // reference so the button disappears rather than firing a no-op prompt() again.
          await deferredEvent.userChoice;
          setDeferredEvent(null);
        }}
      >
        <Download className="h-4 w-4" />
        {t('installApp')}
      </Button>
    </div>
  );
}
