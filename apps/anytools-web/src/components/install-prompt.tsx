'use client';
import { trackEvent } from '@anytools/analytics';
import { Button } from '@anytools/ui';
import { useEffect, useRef, useState } from 'react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      timerRef.current = setTimeout(() => setShow(true), 30_000);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  if (!show || !deferredPrompt) return null;

  const install = async () => {
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    trackEvent('pwa_install', { outcome });
    setDeferredPrompt(null);
    setShow(false);
  };

  return (
    <div className="fixed bottom-4 right-4 max-w-sm p-4 bg-card border rounded-lg shadow-xl z-40">
      <p className="text-sm mb-3">Install AnyTools for offline access</p>
      <div className="flex gap-2">
        <Button size="sm" onClick={install}>
          Install
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setShow(false)}>
          Later
        </Button>
      </div>
    </div>
  );
}
