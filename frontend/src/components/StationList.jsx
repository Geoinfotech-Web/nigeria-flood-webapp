import React from 'react'
import clsx from 'clsx'
import { IconGauge, IconX } from './Icons'

const RISK_COLOR = {
  Normal: { dot: 'bg-green-400', bar: 'bg-green-500', text: 'text-green-400' },
  Watch: { dot: 'bg-yellow-400', bar: 'bg-yellow-500', text: 'text-yellow-400' },
  Warning: { dot: 'bg-orange-400', bar: 'bg-orange-500', text: 'text-orange-400' },
  Emergency: { dot: 'bg-red-400 animate-pulse', bar: 'bg-red-500', text: 'text-red-400' },
}

export default function StationList({ stations, liveReadings, selected, onSelect, onReset, theme = 'dark' }) {
  return (
    <div className="p-3">
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-2">
          <IconGauge size={13} className={theme === 'dark' ? 'text-gray-500' : 'text-slate-500'} />
          <p className={clsx('text-[10px] font-semibold uppercase tracking-widest', theme === 'dark' ? 'text-gray-500' : 'text-slate-500')}>
            Gauge Stations
          </p>
        </div>

        {selected && (
          <button
            type="button"
            onClick={onReset}
            className={clsx(
              'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium transition',
              theme === 'dark'
                ? 'border-gray-700/70 bg-gray-800/60 text-gray-300 hover:border-gray-600 hover:bg-gray-800 hover:text-white'
                : 'border-slate-200 bg-slate-100 text-slate-600 hover:border-slate-300 hover:bg-white hover:text-slate-900'
            )}
            aria-label="Reset selected station"
            title="Reset selected station"
          >
            <IconX size={11} />
            Reset
          </button>
        )}
      </div>

      <div className="space-y-1">
        {stations.map(s => {
          const r = liveReadings[s.id]
          const risk = r?.risk_tier || 'Normal'
          const pct = r ? Math.round((r.water_level_m / s.bank_full_m) * 100) : null
          const c = RISK_COLOR[risk]
          const isSelected = selected === s.id

          return (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              className={clsx(
                'w-full rounded-lg border px-3 py-2.5 text-left transition-all',
                isSelected
                  ? 'bg-blue-950/60 border-blue-700/70 shadow-[0_0_0_1px_rgba(59,130,246,0.2)]'
                  : theme === 'dark'
                    ? 'bg-gray-800/30 border-transparent hover:bg-gray-800/60 hover:border-gray-700/50'
                    : 'bg-slate-50 border-slate-200 shadow-sm hover:bg-white hover:border-slate-300'
              )}
            >
              <div className="flex items-center gap-2.5">
                <span className={clsx('h-2 w-2 rounded-full shrink-0', c.dot)} />
                <span className={clsx('truncate text-[13px] font-medium', isSelected ? 'text-white' : theme === 'dark' ? 'text-gray-200' : 'text-slate-800')}>
                  {s.name}
                </span>
              </div>

              <div className={clsx('mt-0.5 pl-[18px] text-[11px]', theme === 'dark' ? 'text-gray-500' : 'text-slate-500')}>
                {s.river} &middot; {s.state}
              </div>

              {pct !== null && (
                <div className="mt-2 pl-[18px]">
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <span className={theme === 'dark' ? 'text-gray-600' : 'text-slate-500'}>Bank level</span>
                    <span className={clsx('font-semibold tabular-nums', c.text)}>
                      {pct}%
                    </span>
                  </div>
                  <div className={clsx('h-1 overflow-hidden rounded-full', theme === 'dark' ? 'bg-gray-800' : 'bg-slate-200')}>
                    <div
                      className={clsx('h-full rounded-full transition-all duration-500', c.bar)}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
