import React from 'react'
import clsx from 'clsx'
import { IconGauge } from './Icons'

const RISK_COLOR = {
  Normal:    { dot: 'bg-green-400',  bar: 'bg-green-500',  text: 'text-green-400' },
  Watch:     { dot: 'bg-yellow-400', bar: 'bg-yellow-500', text: 'text-yellow-400' },
  Warning:   { dot: 'bg-orange-400', bar: 'bg-orange-500', text: 'text-orange-400' },
  Emergency: { dot: 'bg-red-400 animate-pulse', bar: 'bg-red-500', text: 'text-red-400' },
}

export default function StationList({ stations, liveReadings, selected, onSelect }) {
  return (
    <div className="p-3">
      <div className="flex items-center gap-2 px-1 mb-3">
        <IconGauge size={13} className="text-gray-500" />
        <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">
          Gauge Stations
        </p>
      </div>

      <div className="space-y-1">
        {stations.map(s => {
          const r    = liveReadings[s.id]
          const risk = r?.risk_tier || 'Normal'
          const pct  = r ? Math.round((r.water_level_m / s.bank_full_m) * 100) : null
          const c    = RISK_COLOR[risk]
          const isSelected = selected === s.id

          return (
            <button
              key={s.id}
              onClick={() => onSelect(s.id)}
              className={clsx(
                'w-full text-left px-3 py-2.5 rounded-lg border transition-all',
                isSelected
                  ? 'bg-blue-950/60 border-blue-700/70 shadow-[0_0_0_1px_rgba(59,130,246,0.2)]'
                  : 'bg-gray-800/30 border-transparent hover:bg-gray-800/60 hover:border-gray-700/50'
              )}
            >
              <div className="flex items-center gap-2.5">
                <span className={clsx('h-2 w-2 rounded-full shrink-0', c.dot)} />
                <span className={clsx('text-[13px] font-medium truncate',
                  isSelected ? 'text-white' : 'text-gray-200')}>
                  {s.name}
                </span>
              </div>

              <div className="text-[11px] text-gray-500 mt-0.5 pl-[18px]">
                {s.river} &middot; {s.state}
              </div>

              {pct !== null && (
                <div className="mt-2 pl-[18px]">
                  <div className="flex justify-between items-center text-[11px] mb-1">
                    <span className="text-gray-600">Bank level</span>
                    <span className={clsx('font-semibold tabular-nums', c.text)}>
                      {pct}%
                    </span>
                  </div>
                  <div className="h-1 bg-gray-800 rounded-full overflow-hidden">
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
