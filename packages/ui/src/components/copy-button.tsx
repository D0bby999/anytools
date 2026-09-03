'use client';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Button } from './button';

export interface CopyButtonProps {
  text: string;
  className?: string;
  size?: 'default' | 'sm' | 'icon';
  /** Fired after the text reaches the clipboard. Used for analytics. */
  onCopied?: () => void;
}

export function CopyButton({ text, className, size = 'sm', onCopied }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      onCopied?.();
    } catch {
      // clipboard unavailable
    }
  };

  return (
    <Button
      variant="outline"
      size={size}
      onClick={handleCopy}
      className={className}
      aria-label="Copy"
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      <span className="ml-1.5 text-xs">{copied ? 'Copied' : 'Copy'}</span>
    </Button>
  );
}
