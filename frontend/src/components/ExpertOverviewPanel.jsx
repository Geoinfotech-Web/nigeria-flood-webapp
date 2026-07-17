import React, { useMemo } from 'react'
import clsx from 'clsx'
import { IconActivity, IconGauge } from './Icons'

const RISK_ORDER = { Normal: 0, Watch: 1, Warning: 2, Emergency: 3 }
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

function bankPct(station, reading) {
  if (!reading) return null
  if (reading.pct_bank != null) return Number(reading.pct_bank)
  if (station?.bank_full_m && reading.water_level_m != null) {
    return Math.round((reading.water_level_m / station.bank_full_m) * 1000) / 10
  }
  return null
}

function riskFromBank(pct) {
  if (pct == null) return 'Normal'
  if (pct >= 100) return 'Emergency'
  if (pct >= 85) return 'Warning'
  if (pct >= 70) return 'Watch'
  return 'Normal'
}

function stationRisk(reading, pred, pct) {
  if (reading?.risk_tier && RISK_ORDER[reading.risk_tier] != null) return reading.risk_tier
  if (pred?.overall_risk && RISK_ORDER[pred.overall_risk] != null) return pred.overall_risk
  return riskFromBank(pct)
}

function maxHorizonProb(pred) {
  const horizons = pred?.horizons || {}
  let best = 0
  for (const v of Object.values(horizons)) {
    const p = Number(v?.flood_prob) || 0
    if (p > best) best = p
  }
  return best
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

  const topAtRisk = useMemo(() => {
    const rows = stations.map((s) => {
      const reading = liveReadings[s.id]
      const pred = predictionsByStation[s.id]
      const pct = bankPct(s, reading)
      const risk = stationRisk(reading, pred, pct)
      const floodProb = maxHorizonProb(pred)
      return {
        id: s.id,
        name: s.name,
        river: s.river,
        state: s.state,
        risk,
        pct,
        floodProb,
        score:
          RISK_ORDER[risk] * 1000 +
          (floodProb || 0) * 100 +
          (pct != null ? pct / 100 : 0),
      }
    })
    return rows.sort((a, b) => b.score - a.score).slice(0, 5)
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
              Top at-risk gauges
            </p>
          </div>
          <div className="space-y-1.5">
            {topAtRisk.map((row, idx) => {
              const style = TIER_STYLE[row.risk] || TIER_STYLE.Normal
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => onSelectStation?.(row.id)}
                  className={clsx(
                    'flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition',
                    dark
                      ? 'border-gray-800 bg-gray-900/50 hover:border-gray-700 hover:bg-gray-800/70'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
                  )}
                >
                  <span
                    className={clsx(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold',
                      dark ? 'bg-gray-800 text-gray-400' : 'bg-slate-100 text-slate-500',
                    )}
                  >
                    {idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className={clsx(
                        'truncate text-[12px] font-medium',
                        dark ? 'text-gray-100' : 'text-slate-800',
                      )}
                    >
                      {row.name}
                    </p>
                    <p
                      className={clsx(
                        'truncate text-[10px]',
                        dark ? 'text-gray-500' : 'text-slate-500',
                      )}
                    >
                      {row.river} · {row.state}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <span
                      className={clsx(
                        'inline-block rounded border px-1.5 py-0.5 text-[9px] font-semibold',
                        dark ? style.dark : style.light,
                      )}
                    >
                      {row.risk}
                    </span>
                    <p
                      className={clsx(
                        'mt-0.5 text-[10px] tabular-nums',
                        dark ? 'text-gray-400' : 'text-slate-500',
                      )}
                    >
                      {row.pct != null ? `${Math.round(row.pct)}% bank` : '—'}
                      {row.floodProb > 0 ? ` · ${Math.round(row.floodProb * 100)}%` : ''}
                    </p>
                  </div>
                </button>
              )
            })}
            {topAtRisk.length === 0 && (
              <p className={clsx('text-[11px]', dark ? 'text-gray-500' : 'text-slate-500')}>
                No gauge data yet.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
