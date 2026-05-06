import React, { useEffect, useState } from 'react'
import clsx from 'clsx'
import axios from 'axios'
import { IconAlertTriangle } from './Icons'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const TIER_STYLE = {
  Watch: 'bg-yellow-950/80 border-yellow-700/60 text-yellow-300',
  Warning: 'bg-orange-950/80 border-orange-700/60 text-orange-300',
  Emergency: 'bg-red-950/80 border-red-700/60 text-red-300',
}

const TIER_ICON_COLOR = {
  Watch: 'text-yellow-400',
  Warning: 'text-orange-400',
  Emergency: 'text-red-400',
}

export default function AlertBanner({ theme = 'dark' }) {
  const [alerts, setAlerts] = useState([])

  useEffect(() => {
    const load = () =>
      axios.get(`${API}/alerts?limit=5`)
        .then(r => setAlerts(r.data.filter(a => a.risk_tier !== 'Normal')))
        .catch(console.error)
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [])

  if (!alerts.length) return null

  return (
    <div
      className={clsx(
        'flex gap-2 px-4 py-2 overflow-x-auto border-b shrink-0 scrollbar-none',
        theme === 'dark' ? 'bg-gray-950 border-gray-800' : 'bg-slate-100 border-slate-200'
      )}
    >
      {alerts.map(a => (
        <div
          key={a.id}
          className={clsx(
            'flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[11px] shrink-0 font-medium',
            TIER_STYLE[a.risk_tier]
          )}
        >
          <IconAlertTriangle size={12} className={TIER_ICON_COLOR[a.risk_tier]} />
          <span className="font-bold tracking-wide">{a.risk_tier.toUpperCase()}</span>
          <span className="opacity-80">{a.station_name}</span>
          <span className="opacity-50">&mdash;</span>
          <span className="opacity-70 tabular-nums">
            {(a.flood_prob * 100).toFixed(0)}% probability
          </span>
        </div>
      ))}
    </div>
  )
}
