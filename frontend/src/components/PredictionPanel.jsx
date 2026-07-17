import React, { useEffect, useState } from 'react'
import axios from 'axios'
import clsx from 'clsx'
import { IconActivity } from './Icons'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const RISK_STYLE = {
  dark: {
    Normal: {
      badge: 'text-green-300 bg-green-950/70 border-green-800',
      card: 'bg-green-950/40 border-green-900/60 text-green-300',
    },
    Watch: {
      badge: 'text-yellow-300 bg-yellow-950/70 border-yellow-800',
      card: 'bg-yellow-950/40 border-yellow-900/60 text-yellow-300',
    },
    Warning: {
      badge: 'text-orange-300 bg-orange-950/70 border-orange-800',
      card: 'bg-orange-950/40 border-orange-900/60 text-orange-300',
    },
    Emergency: {
      badge: 'text-red-300 bg-red-950/70 border-red-800',
      card: 'bg-red-950/40 border-red-900/60 text-red-300',
    },
  },
  light: {
    Normal: {
      badge: 'text-emerald-800 bg-emerald-50 border-emerald-200',
      card: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    },
    Watch: {
      badge: 'text-amber-800 bg-amber-50 border-amber-200',
      card: 'bg-amber-50 border-amber-200 text-amber-800',
    },
    Warning: {
      badge: 'text-orange-800 bg-orange-50 border-orange-200',
      card: 'bg-orange-50 border-orange-200 text-orange-800',
    },
    Emergency: {
      badge: 'text-red-800 bg-red-50 border-red-200',
      card: 'bg-red-50 border-red-200 text-red-800',
    },
  },
}

function modelNote(horizons) {
  let hasXgb = false
  let hasLstm = false
  for (const v of Object.values(horizons || {})) {
    if (v?.xgb_prob != null) hasXgb = true
    if (v?.lstm_prob != null) hasLstm = true
  }
  if (hasXgb && hasLstm) return 'XGBoost + LSTM ensemble (where available)'
  if (hasXgb) return 'XGBoost primary · LSTM when registered'
  if (hasLstm) return 'LSTM primary'
  return 'Model output'
}

export default function PredictionPanel({
  stationId,
  theme = 'dark',
  liveReading = null,
  station = null,
  variant = 'full', // 'full' | 'forecastOnly'
}) {
  const [data, setData] = useState(null)
  const dark = theme === 'dark'
  const styles = dark ? RISK_STYLE.dark : RISK_STYLE.light
  const forecastOnly = variant === 'forecastOnly'

  useEffect(() => {
    if (!stationId) return undefined
    setData(null)
    const load = () =>
      axios
        .get(`${API}/stations/${stationId}/predictions`)
        .then((r) => setData(r.data))
        .catch(console.error)
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [stationId])

  if (!data) {
    return (
      <div
        className={clsx(
          'flex items-center gap-2 py-2 text-xs',
          dark ? 'text-gray-600' : 'text-slate-500',
        )}
      >
        <span
          className={clsx(
            'h-3 w-3 animate-spin rounded-full border-2',
            dark ? 'border-gray-700 border-t-gray-400' : 'border-slate-300 border-t-slate-500',
          )}
        />
        Loading predictions...
      </div>
    )
  }

  const horizons = data.horizons || {}
  const overall = data.overall_risk || 'Normal'
  const s = styles[overall] ?? styles.Normal

  const bankFull = station?.bank_full_m ?? liveReading?.bank_full_m
  const level = liveReading?.water_level_m
  const pct =
    liveReading?.pct_bank != null
      ? Number(liveReading.pct_bank)
      : bankFull && level != null
        ? Math.round((level / bankFull) * 1000) / 10
        : null

  const flow = liveReading?.flow_rate_m3s

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <IconActivity size={13} className={dark ? 'text-gray-500' : 'text-slate-500'} />
          <h3
            className={clsx(
              'text-[10px] font-semibold uppercase tracking-widest',
              dark ? 'text-gray-500' : 'text-slate-500',
            )}
          >
            Flood forecast
          </h3>
        </div>
        <span className={clsx('text-[9px]', dark ? 'text-gray-600' : 'text-slate-400')}>
          Ops tiers: Watch · Warning · Emergency
        </span>
      </div>

      {!forecastOnly && (level != null || pct != null) && (
        <div
          className={clsx(
            'grid grid-cols-3 gap-1.5 rounded-lg border px-2.5 py-2',
            dark ? 'border-gray-800 bg-gray-900/50' : 'border-slate-200 bg-slate-50',
          )}
        >
          <div>
            <p className={clsx('text-[9px]', dark ? 'text-gray-500' : 'text-slate-500')}>Stage</p>
            <p
              className={clsx(
                'text-sm font-bold tabular-nums',
                dark ? 'text-gray-100' : 'text-slate-900',
              )}
            >
              {level != null ? `${Number(level).toFixed(2)} m` : '—'}
            </p>
          </div>
          <div>
            <p className={clsx('text-[9px]', dark ? 'text-gray-500' : 'text-slate-500')}>
              Bankfull
            </p>
            <p
              className={clsx(
                'text-sm font-bold tabular-nums',
                dark ? 'text-gray-100' : 'text-slate-900',
              )}
            >
              {bankFull != null ? `${Number(bankFull).toFixed(1)} m` : '—'}
            </p>
          </div>
          <div>
            <p className={clsx('text-[9px]', dark ? 'text-gray-500' : 'text-slate-500')}>
              % of bank
            </p>
            <p
              className={clsx(
                'text-sm font-bold tabular-nums',
                dark ? 'text-gray-100' : 'text-slate-900',
              )}
            >
              {pct != null ? `${pct}%` : '—'}
            </p>
          </div>
          {flow != null && (
            <div className="col-span-3 border-t pt-1.5 mt-0.5 border-inherit">
              <p className={clsx('text-[10px] tabular-nums', dark ? 'text-gray-400' : 'text-slate-600')}>
                Discharge {Number(flow).toFixed(1)} m³/s
                {liveReading?.time
                  ? ` · ${new Date(liveReading.time).toLocaleTimeString(undefined, {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}`
                  : ''}
              </p>
            </div>
          )}
        </div>
      )}

      <div className={clsx('flex items-center justify-between rounded-lg border px-3 py-2', s.badge)}>
        <span className="text-[11px] font-medium opacity-70">Overall risk</span>
        <span className="text-sm font-bold tracking-wide">{overall}</span>
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        {Object.entries(horizons).map(([h, v]) => {
          const cs = styles[v.risk_tier] ?? styles.Normal
          return (
            <div key={h} className={clsx('rounded-lg border px-2 py-2 text-center', cs.card)}>
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

      <p className={clsx('text-[10px] leading-snug', dark ? 'text-gray-500' : 'text-slate-500')}>
        {modelNote(horizons)}
      </p>
    </div>
  )
}
