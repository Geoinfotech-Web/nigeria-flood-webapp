import React, { useEffect, useState } from 'react'
import axios from 'axios'
import clsx from 'clsx'
import { IconAlertTriangle } from './Icons'
import { RISK_COLOR, RISK_LABEL } from '../lib/riskCopy'
import AffectedPlacesStat from './AffectedPlacesStat'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export default function NationalAlertsStrip({
  theme = 'light',
  onSelectStation,
  affectedSummary = null,
  affectedLoading = false,
  affectedScope = 'nationwide',
  placeName = null,
}) {
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

  const highlyLikely = affectedSummary?.highly_likely ?? affectedSummary?.total ?? 0

  return (
    <div
      className={clsx(
        'flex flex-col gap-2 border-b shrink-0 px-3 py-2 sm:px-4',
        theme === 'dark' ? 'border-gray-800 bg-gray-950' : 'border-slate-200 bg-slate-50',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <AffectedPlacesStat
          summary={affectedSummary}
          loading={affectedLoading}
          theme={theme}
          compact
          scope={affectedScope}
          placeName={placeName}
        />
        {!alerts.length && !affectedLoading && highlyLikely === 0 && (
          <span
            className={clsx(
              'text-xs',
              theme === 'dark' ? 'text-teal-200/90' : 'text-teal-900',
            )}
          >
            No active flood alerts nationwide from monitored gauges.
          </span>
        )}
      </div>

      {alerts.length > 0 && (
        <div className="flex gap-2 overflow-x-auto scrollbar-none">
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
              <span
                className={clsx(
                  'tabular-nums',
                  theme === 'dark' ? 'text-gray-500' : 'text-slate-400',
                )}
              >
                {(a.flood_prob * 100).toFixed(0)}%
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
