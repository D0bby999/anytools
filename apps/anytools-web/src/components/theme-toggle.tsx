'use client';
import { Button } from '@anytools/ui';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

type Theme = 'system' | 'light' | 'dark';
const ORDER: Theme[] = ['system', 'light', 'dark'];
const LABELS: Record<Theme, string> = {
  system: 'System theme',
  light: 'Light theme',
  dark: 'Dark theme',
};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Avoid hydration mismatch — render neutral icon until mounted
  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" aria-label="Theme">
        <Monitor className="h-4 w-4" />
      </Button>
    );
  }

  const current = (theme as Theme) ?? 'system';
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length] ?? 'system';
  const Icon = current === 'light' ? Sun : current === 'dark' ? Moon : Monitor;

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${LABELS[next]}`}
      title={LABELS[current]}
    >
      <Icon className="h-4 w-4 transition-transform duration-220 ease-default" />
    </Button>
  );
}
