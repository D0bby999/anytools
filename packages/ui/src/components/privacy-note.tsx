'use client';
import { useUiStrings } from '../i18n/ui-strings';
import { cn } from '../lib/cn';

export interface PrivacyNoteProps {
  /** Override the default note; leave unset to get the locale-aware default. */
  message?: string;
  className?: string;
}

export function PrivacyNote({ message, className }: PrivacyNoteProps) {
  const s = useUiStrings();
  return (
    <p className={cn('text-xs text-muted-foreground', className)}>{message ?? s.privacyNote}</p>
  );
}
