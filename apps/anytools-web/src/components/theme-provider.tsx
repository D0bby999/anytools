'use client';
import { ThemeProvider as NextThemesProvider, type ThemeProviderProps } from 'next-themes';

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      // Light is the default for first-time visitors (owner decision 260829).
      // Users who already picked a theme keep it via storageKey; System stays
      // selectable through the header toggle.
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
      storageKey="anytools:theme"
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
