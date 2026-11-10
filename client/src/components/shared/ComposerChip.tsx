import React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The chip that sits inside a composer to say what the next message carries —
 * a picked skill on the homescreen, an attached work item in Brain chat.
 *
 * Extracted from HomePage's inline "selected chip badge" so both composers are
 * literally the same control: same height, radius, border, type scale, and the
 * same grey X that clears it.
 */
export function ComposerChip({
  icon,
  label,
  onRemove,
  removeLabel = 'Remove',
  title,
  disabled,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  /** Omit to render a non-dismissible chip (e.g. in a sent message). */
  onRemove?: () => void;
  removeLabel?: string;
  title?: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 h-9 px-3 rounded-full bg-white border border-[#F0F0F0]',
        'font-inter text-[12px] sm:text-[13px] font-medium text-black',
        disabled && 'opacity-50 cursor-not-allowed',
        className,
      )}
      title={title}
    >
      {icon}
      <span className="truncate">{label}</span>
      {onRemove && !disabled && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="ml-0.5 text-[#B9B9B7] hover:text-black transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
