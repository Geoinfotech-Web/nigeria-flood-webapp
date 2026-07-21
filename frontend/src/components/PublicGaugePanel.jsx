import React, { useEffect, useState } from 'react'
import axios from 'axios'
import clsx from 'clsx'
import { IconX } from './Icons'
import GaugeChart from './GaugeChart'
import RainfallChart from './RainfallChart'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const RISK_STYLE = {
  dark: {
    Normal: 'border-emerald-800 bg-emerald-950/50 text-emerald-300',
    Watch: 'border-amber-800 bg-amber-950/50 text-amber-300',
    Warning: 'border-orange-800 bg-orange-950/50 text-orange-300',
    Emergency: 'border-red-800 bg-red-950/50 text-red-300',
  },
  light: {
    Normal: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    Watch: 'border-amber-200 bg-amber-50 text-amber-800',
    Warning: 'border-orange-200 bg-orange-50 text-orange-800',
    Emergency: 'border-red-200 bg-red-50 text-red-800',
  },
}

export default function PublicGaugePanel({
  station,
  stationId,
  liveReading = null,
  theme = 'light',
  basinVisible = false,
  onToggleBasin,
  onClose,
}) {
  const dark = theme === 'dark'
  const [latestReading, setLatestReading] = useState(null)
  const [rainToday, setRainToday] = useState(null)

  // Prefer live WS reading when it has a level; otherwise fall back to API
  // (same pattern as StationConsole — WS is often empty until the first push).
  const effectiveReading =
    liveReading?.water_level_m != null || liveReading?.time
      ? liveReading
      : latestReading

  const risk = effectiveReading?.risk_tier || liveReading?.risk_tier || 'Normal'
  const level = effectiveReading?.water_level_m
  const bank = station?.bank_full_m ?? liveReading?.bank_full_m
  const pct =
    liveReading?.pct_bank != null
      ? Number(liveReading.pct_bank)
      : level != null && bank > 0
        ? Math.min(100, Math.round((level / bank) * 100))
        : null

  useEffect(() => {
    if (!stationId) return undefined
    setLatestReading(null)
    setRainToday(null)
    let cancelled = false
    axios
      .get(`${API}/stations/${stationId}/latest-reading`)
      .then((r) => {
        if (!cancelled) setLatestReading(r.data || null)
      })
      .catch(() => {
        if (!cancelled) setLatestReading(null)
      })
    axios
      .get(`${API}/stations/${stationId}/rainfall?days=1`)
      .then((r) => {
        if (cancelled) return
        const rows = Array.isArray(r.data) ? r.data : []
        const total = rows.reduce((sum, row) => sum + (Number(row.total_rain_mm) || 0), 0)
        setRainToday(total)
      })
      .catch(() => {
        if (!cancelled) setRainToday(null)
      })
    return () => {
      cancelled = true
    }
  }, [stationId])

  if (!station) return null

  const riskClass = (dark ? RISK_STYLE.dark : RISK_STYLE.light)[risk] || RISK_STYLE.light.Normal
  const hasBasin = Boolean(station.basin_id)

  return (
    <div
      className={clsx(
        'flex h-full flex-col overflow-hidden border md:rounded-2xl',
        'rounded-t-2xl md:rounded-2xl',
        dark ? 'border-gray-800 bg-gray-950/95' : 'border-slate-200 bg-white',
      )}
    >
      <header
        className={clsx(
          'flex shrink-0 items-start justify-between gap-2 border-b px-4 py-3',
          dark ? 'border-gray-800' : 'border-slate-100',
        )}
      >
        <div className="min-w-0">
          <p
            className={clsx(
              'text-[10px] font-semibold uppercase tracking-[0.14em]',
              dark ? 'text-sky-400/80' : 'text-sky-700',
            )}
          >
            River gauge
          </p>
          <h2
            className={clsx(
              'font-display mt-0.5 truncate text-lg font-semibold tracking-tight',
              dark ? 'text-white' : 'text-slate-900',
            )}
          >
            {station.name}
          </h2>
          <p className={clsx('text-xs', dark ? 'text-gray-400' : 'text-slate-500')}>
            {station.river} · {station.state}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className={clsx(
            'rounded-lg p-1.5 transition',
            dark ? 'text-gray-400 hover:bg-gray-800 hover:text-white' : 'text-slate-500 hover:bg-slate-100',
          )}
          aria-label="Close gauge panel"
        >
          <IconX size={16} />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={clsx('rounded-md border px-2 py-0.5 text-[11px] font-semibold', riskClass)}>
            {risk}
          </span>
          <span className={clsx('text-xs tabular-nums', dark ? 'text-gray-300' : 'text-slate-700')}>
            {level != null ? `${Number(level).toFixed(2)} m` : '—'}
            {pct != null ? ` · ${pct}% bankfull` : ''}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div
            className={clsx(
              'rounded-lg border px-2.5 py-2',
              dark ? 'border-gray-800 bg-gray-900/60' : 'border-slate-200 bg-slate-50',
            )}
          >
            <p className={clsx('text-[9px] uppercase tracking-wide', dark ? 'text-gray-500' : 'text-slate-500')}>
              Water level
            </p>
            <p
              className={clsx(
                'mt-0.5 font-display text-xl font-semibold tabular-nums',
                dark ? 'text-white' : 'text-slate-900',
              )}
            >
              {level != null ? `${Number(level).toFixed(2)}` : '—'}
              <span className="ml-0.5 text-xs font-normal opacity-60">m</span>
            </p>
          </div>
          <div
            className={clsx(
              'rounded-lg border px-2.5 py-2',
              dark ? 'border-cyan-900/40 bg-cyan-950/30' : 'border-cyan-200 bg-cyan-50',
            )}
          >
            <p className={clsx('text-[9px] uppercase tracking-wide', dark ? 'text-cyan-400/80' : 'text-cyan-700')}>
              Rain 24h
            </p>
            <p
              className={clsx(
                'mt-0.5 font-display text-xl font-semibold tabular-nums',
                dark ? 'text-cyan-200' : 'text-cyan-900',
              )}
            >
              {rainToday != null ? rainToday.toFixed(1) : '—'}
              <span className="ml-0.5 text-xs font-normal opacity-60">mm</span>
            </p>
          </div>
        </div>

        <div>
          <p
            className={clsx(
              'mb-1 text-[10px] font-semibold uppercase tracking-wide',
              dark ? 'text-gray-500' : 'text-slate-500',
            )}
          >
            Water level pattern
          </p>
          <GaugeChart
            stationId={stationId}
            liveReading={effectiveReading}
            theme={theme}
            mode="readings"
            hours={24}
            title=" "
            height={140}
          />
        </div>

        <div>
          <p
            className={clsx(
              'mb-1 text-[10px] font-semibold uppercase tracking-wide',
              dark ? 'text-gray-500' : 'text-slate-500',
            )}
          >
            Rainfall pattern (7 days)
          </p>
          <RainfallChart stationId={stationId} theme={theme} />
        </div>

        <div
          className={clsx(
            'rounded-xl border p-3',
            dark ? 'border-sky-900/40 bg-sky-950/20' : 'border-sky-200 bg-sky-50/80',
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p
                className={clsx(
                  'text-xs font-semibold',
                  dark ? 'text-sky-200' : 'text-sky-900',
                )}
              >
                River basin
              </p>
              <p className={clsx('mt-0.5 text-[10px] leading-snug', dark ? 'text-sky-300/70' : 'text-sky-700/80')}>
                {hasBasin
                  ? 'Show this gauge’s HydroBASINS catchment on the map'
                  : 'No basin assigned for this gauge'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={basinVisible}
              disabled={!hasBasin}
              onClick={() => onToggleBasin?.(!basinVisible)}
              className={clsx(
                'relative h-7 w-12 shrink-0 rounded-full transition',
                !hasBasin && 'cursor-not-allowed opacity-40',
                basinVisible
                  ? 'bg-sky-600'
                  : dark
                    ? 'bg-gray-700'
                    : 'bg-slate-300',
              )}
            >
              <span
                className={clsx(
                  'absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition',
                  basinVisible ? 'left-[1.35rem]' : 'left-0.5',
                )}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
