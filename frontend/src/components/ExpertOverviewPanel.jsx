import React, { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { IconActivity, IconChevronDown, IconGauge } from './Icons'
import { bankPct, RISK_ORDER, stationRisk } from '../lib/stationRisk'

const TIERS = ['Emergency', 'Warning', 'Watch', 'Normal']

const TIER_STYLE = {
  Emergency: {
    dark: 'bg-red-950/50 border-red-800 text-red-300',
    light: 'bg-red-50 border-red-200 text-red-800',
  },
  Warning: {
    dark: 'bg-orange-950/50 border-orange-800 text-orange-300',
    light: 'bg-orange-50 border-orange-200 text-orange-800',
  },
  Watch: {
    dark: 'bg-yellow-950/50 border-yellow-800 text-yellow-300',
    light: 'bg-amber-50 border-amber-200 text-amber-800',
  },
  Normal: {
    dark: 'bg-green-950/40 border-green-900/60 text-green-300',
    light: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  },
}

export default function ExpertOverviewPanel({
  stations = [],
  liveReadings = {},
  predictionsByStation = {},
  predictionsUpdatedAt = null,
  predictionsLoading = false,
  onSelectStation,
  theme = 'light',
}) {
  const dark = theme === 'dark'
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const dropdownRef = useRef(null)

  useEffect(() => {
    if (!dropdownOpen) return undefined
    const onClickAway = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickAway)
    return () => document.removeEventListener('mousedown', onClickAway)
  }, [dropdownOpen])

  const tierCounts = useMemo(() => {
    const counts = { Normal: 0, Watch: 0, Warning: 0, Emergency: 0 }
    for (const s of stations) {
      const r = liveReadings[s.id]
      const pct = bankPct(s, r)
      const pred = predictionsByStation[s.id]
      const tier = stationRisk(r, pred, pct)
      counts[tier] = (counts[tier] || 0) + 1
    }
    return counts
  }, [stations, liveReadings, predictionsByStation])

  const elevatedCount =
    (tierCounts.Watch || 0) + (tierCounts.Warning || 0) + (tierCounts.Emergency || 0)

  const latestReadingTime = useMemo(() => {
    let latest = null
    for (const r of Object.values(liveReadings)) {
      if (!r?.time) continue
      const t = new Date(r.time)
      if (!Number.isNaN(t.getTime()) && (!latest || t > latest)) latest = t
    }
    return latest
  }, [liveReadings])

  const stationOptions = useMemo(() => {
    return stations
      .map((s) => {
      const reading = liveReadings[s.id]
      const pred = predictionsByStation[s.id]
      const pct = bankPct(s, reading)
      const risk = stationRisk(reading, pred, pct)
      return {
        id: s.id,
        name: s.name,
        river: s.river,
        state: s.state,
        risk,
        pct,
        label: `${s.name} - ${s.river || 'Unknown river'}${s.state ? ` · ${s.state}` : ''} [${risk}]`,
      }
    })
      .sort((a, b) => {
        const riskDelta = (RISK_ORDER[b.risk] || 0) - (RISK_ORDER[a.risk] || 0)
        if (riskDelta) return riskDelta
        const pctDelta = (b.pct ?? -1) - (a.pct ?? -1)
        if (pctDelta) return pctDelta
        return a.name.localeCompare(b.name)
      })
  }, [stations, liveReadings, predictionsByStation])

  const statusLine =
    elevatedCount === 0
      ? 'All gauges at Normal — no Watch+ alerts'
      : `${elevatedCount} of ${stations.length} gauges at Watch or higher`

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div
        className={clsx(
          'border-b px-4 py-3',
          dark ? 'border-gray-800' : 'border-slate-200',
        )}
      >
        <div className="flex items-center gap-2">
          <IconActivity size={13} className={dark ? 'text-sky-400' : 'text-sky-700'} />
          <p
            className={clsx(
              'text-[10px] font-semibold uppercase tracking-widest',
              dark ? 'text-gray-500' : 'text-slate-500',
            )}
          >
            Network overview
          </p>
        </div>
        <p className={clsx('mt-1 text-sm font-semibold', dark ? 'text-white' : 'text-slate-900')}>
          Gauge console
        </p>
        <p className={clsx('mt-0.5 text-[11px]', dark ? 'text-gray-400' : 'text-slate-500')}>
          {statusLine}
        </p>
      </div>

      <div className="space-y-4 p-4">
        <div>
          <p
            className={clsx(
              'mb-2 text-[10px] font-semibold uppercase tracking-widest',
              dark ? 'text-gray-500' : 'text-slate-500',
            )}
          >
            Risk tiers
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {TIERS.map((tier) => {
              const style = TIER_STYLE[tier]
              return (
                <div
                  key={tier}
                  className={clsx(
                    'rounded-lg border px-2.5 py-2',
                    dark ? style.dark : style.light,
                  )}
                >
                  <div className="text-[10px] font-medium opacity-80">{tier}</div>
                  <div className="text-lg font-bold tabular-nums leading-tight">
                    {tierCounts[tier] || 0}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div
          className={clsx(
            'rounded-lg border px-3 py-2 text-[11px]',
            dark ? 'border-gray-800 bg-gray-900/60 text-gray-400' : 'border-slate-200 bg-slate-50 text-slate-600',
          )}
        >
          <div className="flex justify-between gap-2">
            <span>Latest gauge ingest</span>
            <span className="font-medium tabular-nums">
              {latestReadingTime
                ? latestReadingTime.toLocaleString(undefined, {
                    hour: '2-digit',
                    minute: '2-digit',
                    day: 'numeric',
                    month: 'short',
                  })
                : 'Waiting…'}
            </span>
          </div>
          <div className="mt-1 flex justify-between gap-2">
            <span>Forecast refresh</span>
            <span className="font-medium tabular-nums">
              {predictionsLoading && !predictionsUpdatedAt
                ? 'Loading…'
                : predictionsUpdatedAt
                  ? predictionsUpdatedAt.toLocaleTimeString(undefined, {
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : '—'}
            </span>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center gap-2">
            <IconGauge size={12} className={dark ? 'text-gray-500' : 'text-slate-500'} />
            <p
              className={clsx(
                'text-[10px] font-semibold uppercase tracking-widest',
                dark ? 'text-gray-500' : 'text-slate-500',
              )}
            >
              Gauge stations
            </p>
          </div>
          <div className="space-y-2" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setDropdownOpen((open) => !open)}
              className={clsx(
                'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left transition',
                dark
                  ? 'border-gray-800 bg-gray-900/60 text-gray-100 hover:border-gray-700 hover:bg-gray-900'
                  : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300',
              )}
              aria-haspopup="listbox"
              aria-expanded={dropdownOpen}
            >
              <span className="min-w-0">
                <span className="block text-[12px] font-medium">Select a gauge station</span>
                <span className={clsx('block truncate text-[10px]', dark ? 'text-gray-500' : 'text-slate-500')}>
                  Emergency and Warning stations appear first.
                </span>
              </span>
              <IconChevronDown
                size={14}
                className={clsx('shrink-0 transition', dropdownOpen && 'rotate-180', dark ? 'text-gray-500' : 'text-slate-400')}
              />
            </button>
            {dropdownOpen && (
              <div
                className={clsx(
                  'max-h-72 overflow-y-auto rounded-xl border p-1.5 shadow-xl',
                  dark ? 'border-gray-800 bg-gray-950/95' : 'border-slate-200 bg-white',
                )}
                role="listbox"
              >
                {stationOptions.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => {
                      onSelectStation?.(row.id)
                      setDropdownOpen(false)
                    }}
                    className={clsx(
                      'mb-1 flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition last:mb-0',
                      dark
                        ? 'border-transparent bg-gray-900/70 hover:border-gray-700 hover:bg-gray-900'
                        : 'border-transparent bg-slate-50 hover:border-slate-200 hover:bg-white',
                    )}
                  >
                    <span
                      className={clsx(
                        'mt-0.5 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold',
                        dark ? TIER_STYLE[row.risk]?.dark : TIER_STYLE[row.risk]?.light,
                      )}
                    >
                      {row.risk}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={clsx('block truncate text-[12px] font-medium', dark ? 'text-white' : 'text-slate-900')}>
                        {row.name}
                      </span>
                      <span className={clsx('block truncate text-[10px]', dark ? 'text-gray-500' : 'text-slate-500')}>
                        {row.river || 'Unknown river'}
                        {row.state ? ` · ${row.state}` : ''}
                        {row.pct != null ? ` · ${row.pct}% bankfull` : ''}
                      </span>
                    </span>
                  </button>
                ))}
                {stationOptions.length === 0 && (
                  <p className={clsx('px-2 py-4 text-[11px]', dark ? 'text-gray-500' : 'text-slate-500')}>
                    No gauge data yet.
                  </p>
                )}
              </div>
            )}
            <p className={clsx('text-[10px]', dark ? 'text-gray-500' : 'text-slate-500')}>
              Monitoring stations remain available here while the left rail focuses on exposed places.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
