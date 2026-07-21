import React from 'react'
import clsx from 'clsx'

export default function DisclaimerBar({ theme = 'light' }) {
  return (
    <p
      className={clsx(
        'shrink-0 border-t px-3 py-1.5 text-center text-[10px] leading-snug sm:px-4 sm:py-2 sm:text-[11px] sm:leading-relaxed',
        'pb-[max(0.375rem,env(safe-area-inset-bottom))]',
        theme === 'dark'
          ? 'border-gray-800 bg-gray-950 text-gray-500'
          : 'border-slate-200 bg-white text-slate-500',
      )}
    >
      Flood forecasts are approximate and for early awareness only. Always confirm with NIHSA, NEMA,
      and local emergency authorities before acting.
    </p>
  )
}
