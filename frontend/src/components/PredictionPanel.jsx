import React, { useEffect, useState } from 'react'
import axios from 'axios'
import clsx from 'clsx'
import { IconActivity } from './Icons'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const RISK_STYLE = {
  Normal: { badge: 'text-green-300 bg-green-950/70 border-green-800', card: 'bg-green-950/40 border-green-900/60 text-green-300' },
  Watch: { badge: 'text-yellow-300 bg-yellow-950/70 border-yellow-800', card: 'bg-yellow-950/40 border-yellow-900/60 text-yellow-300' },
  Warning: { badge: 'text-orange-300 bg-orange-950/70 border-orange-800', card: 'bg-orange-950/40 border-orange-900/60 text-orange-300' },
  Emergency: { badge: 'text-red-300 bg-red-950/70 border-red-800', card: 'bg-red-950/40 border-red-900/60 text-red-300' },
}

export default function PredictionPanel({ stationId, theme = 'dark' }) {
  const [data, setData] = useState(null)

  useEffect(() => {
    if (!stationId) return
    const load = () =>
      axios.get(`${API}/stations/${stationId}/predictions`)
        .then(r => setData(r.data))
        .catch(console.error)
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [stationId])

  if (!data) {
    return (
      <div className={clsx('flex items-center gap-2 py-2 text-xs', theme === 'dark' ? 'text-gray-600' : 'text-slate-500')}>
        <span className={clsx('h-3 w-3 rounded-full border-2 animate-spin', theme === 'dark' ? 'border-gray-700 border-t-gray-400' : 'border-slate-300 border-t-slate-500')} />
        Loading predictions...
      </div>
    )
  }

  const horizons = data.horizons || {}
  const s = RISK_STYLE[data.overall_risk] ?? RISK_STYLE.Normal

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <IconActivity size={13} className={theme === 'dark' ? 'text-gray-500' : 'text-slate-500'} />
        <h3 className={clsx('text-[10px] font-semibold uppercase tracking-widest', theme === 'dark' ? 'text-gray-500' : 'text-slate-500')}>
          Flood Forecast
        </h3>
      </div>

      <div className={clsx('flex items-center justify-between rounded-lg border px-3 py-2.5', s.badge)}>
        <span className="text-[11px] font-medium opacity-70">Overall Risk</span>
        <span className="text-sm font-bold tracking-wide">{data.overall_risk}</span>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {Object.entries(horizons).map(([h, v]) => {
          const cs = RISK_STYLE[v.risk_tier] ?? RISK_STYLE.Normal
          return (
            <div key={h} className={clsx('rounded-lg border px-2 py-2.5 text-center', cs.card)}>
              <div className="text-[11px] font-bold tracking-wide">{h}</div>
              <div className="mt-0.5 text-lg font-bold leading-tight tabular-nums">
                {(v.flood_prob * 100).toFixed(0)}
                <span className="text-[10px] font-normal opacity-60">%</span>
              </div>
              <div className="mt-0.5 truncate text-[10px] opacity-60">{v.risk_tier}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
