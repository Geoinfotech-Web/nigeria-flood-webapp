import React, { useEffect, useState } from 'react'
import axios from 'axios'
import clsx from 'clsx'
import { IconAlertTriangle } from './Icons'
import { RISK_COLOR, RISK_LABEL } from '../lib/riskCopy'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export default function NationalAlertsStrip({ theme = 'light', onSelectStation }) {
  const [alerts, setAlerts] = useState([])

  useEffect(() => {
    const load = () =>
      axios
        .get(`${API}/alerts?limit=12`)
        .then((r) => setAlerts(r.data.filter((a) => a.risk_tier !== 'Normal')))
        .catch(console.error)
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [])

  if (!alerts.length) {
    return (
      <div
        className={clsx(
          'flex items-center gap-2 px-4 py-2 border-b shrink-0 text-xs',
          theme === 'dark'
            ? 'border-gray-800 bg-teal-950/40 text-teal-200/90'
            : 'border-teal-100 bg-teal-50/90 text-teal-900',
        )}
      >
        <span
          className={clsx(
            'h-1.5 w-1.5 rounded-full',
            theme === 'dark' ? 'bg-teal-400' : 'bg-teal-600',
          )}
        />
        No active flood alerts nationwide from monitored gauges.
      </div>
    )
  }

  return (
    <div
      className={clsx(
        'flex gap-2 px-3 py-2 overflow-x-auto border-b shrink-0 scrollbar-none',
        theme === 'dark' ? 'border-gray-800 bg-gray-950' : 'border-slate-200 bg-slate-50',
      )}
    >
      {alerts.map((a) => (
        <button
          key={a.id}
          type="button"
          onClick={() => onSelectStation?.(a.station_name)}
          className={clsx(
            'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-medium shrink-0 transition',
            theme === 'dark'
              ? 'border-white/10 bg-gray-900/80 hover:bg-gray-800'
              : 'border-slate-200 bg-white hover:border-slate-300 shadow-sm',
          )}
        >
          <IconAlertTriangle size={12} style={{ color: RISK_COLOR[a.risk_tier] }} />
          <span style={{ color: RISK_COLOR[a.risk_tier] }} className="font-semibold">
            {RISK_LABEL[a.risk_tier] || a.risk_tier}
          </span>
          <span className={theme === 'dark' ? 'text-gray-300' : 'text-slate-700'}>
            {a.station_name}
          </span>
          <span className={clsx('tabular-nums', theme === 'dark' ? 'text-gray-500' : 'text-slate-400')}>
            {(a.flood_prob * 100).toFixed(0)}%
          </span>
        </button>
      ))}
    </div>
  )
}
