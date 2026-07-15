import React from 'react'
import clsx from 'clsx'

export default function DisclaimerBar({ theme = 'light' }) {
  return (
    <p
      className={clsx(
        'px-4 py-2 text-center text-[11px] leading-relaxed border-t shrink-0',
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
