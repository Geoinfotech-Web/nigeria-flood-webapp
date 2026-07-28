import React from 'react'
import clsx from 'clsx'
import { IconDownload } from './Icons'

/**
 * Prominent report CTA for the active place / urban-flash / user location context.
 */
export default function GenerateReportButton({
  theme = 'light',
  label = 'Generate report',
  subtitle = null,
  disabled = false,
  loading = false,
  onClick,
  className = '',
  size = 'md',
}) {
  const dark = theme === 'dark'
  const compact = size === 'sm'

  return (
    <button
      type="button"
      disabled={disabled || loading}
      onClick={onClick}
      className={clsx(
        'inline-flex items-center gap-2 rounded-xl border font-semibold shadow-lg transition disabled:cursor-not-allowed disabled:opacity-50',
        compact ? 'px-2.5 py-1.5 text-[11px]' : 'px-3.5 py-2.5 text-xs',
        dark
          ? 'border-sky-500/40 bg-sky-600 text-white hover:bg-sky-500'
          : 'border-sky-600 bg-sky-600 text-white hover:bg-sky-700',
        className,
      )}
      title={subtitle || label}
    >
      <IconDownload size={compact ? 12 : 14} />
      <span className="min-w-0 text-left leading-tight">
        <span className="block">{loading ? 'Preparing…' : label}</span>
        {subtitle ? (
          <span className={clsx('block truncate font-medium opacity-90', compact ? 'text-[9px]' : 'text-[10px]')}>
            {subtitle}
          </span>
        ) : null}
      </span>
    </button>
  )
}
