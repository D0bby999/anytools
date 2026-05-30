'use client';
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'anytools:consent';

export type ConsentChoice = 'granted' | 'denied' | 'pending';

type ConsentState = {
  choice: ConsentChoice;
  adsAllowed: boolean;
  analyticsAllowed: boolean;
  grant: () => void;
  deny: () => void;
  reset: () => void;
};

const broadcast = (choice: ConsentChoice) => {
  window.dispatchEvent(new CustomEvent('anytools:consent', { detail: choice }));
};

export function useCookieConsent(): ConsentState {
  const [choice, setChoice] = useState<ConsentChoice>('pending');

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'granted' || stored === 'denied') setChoice(stored);
    } catch {
      // localStorage unavailable (private browsing, etc.)
    }
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ConsentChoice>).detail;
      if (detail) setChoice(detail);
    };
    window.addEventListener('anytools:consent', handler);
    return () => window.removeEventListener('anytools:consent', handler);
  }, []);

  const grant = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, 'granted');
    } catch {
      /* ignore */
    }
    setChoice('granted');
    broadcast('granted');
  }, []);

  const deny = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, 'denied');
    } catch {
      /* ignore */
    }
    setChoice('denied');
    broadcast('denied');
  }, []);

  const reset = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setChoice('pending');
    broadcast('pending');
  }, []);

  return {
    choice,
    adsAllowed: choice === 'granted',
    analyticsAllowed: choice === 'granted',
    grant,
    deny,
    reset,
  };
}
