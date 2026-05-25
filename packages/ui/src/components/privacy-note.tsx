import { cn } from '../lib/cn';

export interface PrivacyNoteProps {
  message?: string;
  className?: string;
}

const DEFAULT_MESSAGE = 'Runs entirely in your browser. Your input never leaves your device.';

export function PrivacyNote({ message = DEFAULT_MESSAGE, className }: PrivacyNoteProps) {
  return <p className={cn('text-xs text-muted-foreground', className)}>{message}</p>;
}
