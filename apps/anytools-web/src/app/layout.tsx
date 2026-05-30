import type { ReactNode } from 'react';
import './globals.css';

/**
 * Root layout intentionally minimal — next-intl handles locale layout
 * at app/[locale]/layout.tsx with <html> + <body> + providers.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
