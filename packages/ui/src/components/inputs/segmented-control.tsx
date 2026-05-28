'use client';

type Option<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  value: T;
  onChange: (next: T) => void;
  options: ReadonlyArray<Option<T>>;
  label?: string;
  ariaLabel?: string;
  className?: string;
};

/**
 * iOS-style segmented control. Each option ≥ 44px tall for touch.
 * Active option uses primary background; inactive uses muted.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
  ariaLabel,
  className,
}: Props<T>) {
  return (
    <div className={className}>
      {label && <span className="block text-sm font-medium mb-1.5">{label}</span>}
      <div
        role="radiogroup"
        aria-label={ariaLabel ?? label}
        className="inline-flex rounded-md border bg-muted p-0.5 w-full"
      >
        {options.map((opt) => {
          const active = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              // biome-ignore lint/a11y/useSemanticElements: visual radio group requires custom styling not supported by native <input type="radio">
              role="radio"
              aria-checked={active}
              onClick={() => onChange(opt.value)}
              className={`flex-1 min-h-11 px-3 text-sm font-medium rounded transition-colors duration-150 ${
                active
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
