import React from 'react'
import clsx from 'clsx'
import { IconDownload } from './Icons'

/**
 * Prominent report CTA for the active place / urban-flash / user location context.
 * variant="icon" matches Home / Layers map chrome (h-10 w-10).
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
  variant = 'button',
}) {
  const dark = theme === 'dark'
  const compact = size === 'sm'
  const iconOnly = variant === 'icon'
  const tip = [label, subtitle].filter(Boolean).join(' — ')

  if (iconOnly) {
    return (
      <button
        type="button"
        disabled={disabled || loading}
        onClick={onClick}
        className={clsx(
          'inline-flex h-10 w-10 items-center justify-center rounded-xl border shadow-lg transition disabled:cursor-not-allowed disabled:opacity-50',
          dark
            ? 'border-gray-700 bg-gray-900 text-gray-200 hover:border-gray-500 hover:bg-gray-800 hover:text-white'
            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900',
          className,
        )}
        style={
          dark
            ? { backgroundColor: '#111827', borderColor: '#374151' }
            : { backgroundColor: '#ffffff', borderColor: '#cbd5e1' }
        }
        title={loading ? 'Preparing…' : tip || label}
        aria-label={loading ? 'Preparing report' : label}
      >
        {loading ? (
          <span
            className={clsx(
              'h-3.5 w-3.5 rounded-full border-2 animate-spin',
              dark ? 'border-gray-600 border-t-sky-400' : 'border-slate-300 border-t-sky-600',
            )}
          />
        ) : (
          <IconDownload size={16} className={dark ? 'text-gray-300' : 'text-slate-600'} />
        )}
      </button>
    )
  }

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
