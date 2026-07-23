import React, { useMemo, useState } from 'react'
import clsx from 'clsx'
import { IconGauge, IconSearch, IconX } from './Icons'

const RISK_COLOR = {
  Normal: { dot: 'bg-green-400', bar: 'bg-green-500', text: 'text-green-400' },
  Watch: { dot: 'bg-yellow-400', bar: 'bg-yellow-500', text: 'text-yellow-400' },
  Warning: { dot: 'bg-orange-400', bar: 'bg-orange-500', text: 'text-orange-400' },
  Emergency: { dot: 'bg-red-400 animate-pulse', bar: 'bg-red-500', text: 'text-red-400' },
}

const RISK_ORDER = { Normal: 0, Watch: 1, Warning: 2, Emergency: 3 }
const RISK_FILTERS = ['All', 'Emergency', 'Warning', 'Watch', 'Normal']

function bankPct(station, reading) {
  if (!reading) return null
  if (reading.pct_bank != null) return Number(reading.pct_bank)
  if (station?.bank_full_m && reading.water_level_m != null) {
    return Math.round((reading.water_level_m / station.bank_full_m) * 100)
  }
  return null
}

/** Derive ops tier from % bankfull when WS payload has no risk_tier. */
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
  if (!pred?.horizons) return null
  let best = null
  for (const [h, v] of Object.entries(pred.horizons)) {
    const key = String(h).endsWith('h') ? String(h) : `${h}h`
    if (!['24h', '48h', '72h'].includes(key)) continue
    const p = Number(v?.flood_prob)
    if (!Number.isFinite(p)) continue
    if (best == null || p > best) best = p
  }
  return best
}

export default function StationList({
  stations,
  liveReadings,
  predictionsByStation = {},
  selected,
  onSelect,
  onReset,
  theme = 'dark',
}) {
  const dark = theme === 'dark'
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('risk') // risk | bank | name
  const [riskFilter, setRiskFilter] = useState('All')
  const [riverFilter, setRiverFilter] = useState('All')

  const rivers = useMemo(() => {
    const set = new Set()
    for (const s of stations) {
      if (s.river) set.add(s.river)
    }
    return ['All', ...[...set].sort((a, b) => a.localeCompare(b))]
  }, [stations])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let rows = stations.map((s) => {
      const reading = liveReadings[s.id]
      const pct = bankPct(s, reading)
      const pred = predictionsByStation[s.id]
      const risk = stationRisk(reading, pred, pct)
      const peekProb = maxHorizonProb(pred)
      return { station: s, reading, risk, pct, peekProb }
    })

    if (q) {
      rows = rows.filter(({ station: s }) => {
        const hay = `${s.name} ${s.river || ''} ${s.state || ''}`.toLowerCase()
        return hay.includes(q)
      })
    }
    if (riskFilter !== 'All') {
      rows = rows.filter((r) => r.risk === riskFilter)
    }
    if (riverFilter !== 'All') {
      rows = rows.filter((r) => r.station.river === riverFilter)
    }

    rows.sort((a, b) => {
      if (sortBy === 'name') return a.station.name.localeCompare(b.station.name)
      if (sortBy === 'bank') return (b.pct ?? -1) - (a.pct ?? -1)
      // risk
      const rd = (RISK_ORDER[b.risk] || 0) - (RISK_ORDER[a.risk] || 0)
      if (rd !== 0) return rd
      return (b.peekProb ?? 0) - (a.peekProb ?? 0) || (b.pct ?? -1) - (a.pct ?? -1)
    })

    return rows
  }, [stations, liveReadings, predictionsByStation, query, sortBy, riskFilter, riverFilter])

  return (
    <div className="flex h-full flex-col p-3">
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-2">
          <IconGauge size={13} className={dark ? 'text-gray-500' : 'text-slate-500'} />
          <p
            className={clsx(
              'text-[10px] font-semibold uppercase tracking-widest',
              dark ? 'text-gray-500' : 'text-slate-500',
            )}
          >
            Gauge triage
          </p>
        </div>

        {selected && (
          <button
            type="button"
            onClick={onReset}
            className={clsx(
              'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium transition',
              dark
                ? 'border-gray-700/70 bg-gray-800/60 text-gray-300 hover:border-gray-600 hover:bg-gray-800 hover:text-white'
                : 'border-slate-200 bg-slate-100 text-slate-600 hover:border-slate-300 hover:bg-white hover:text-slate-900',
            )}
            aria-label="Reset selected station"
            title="Reset selected station"
          >
            <IconX size={11} />
            Reset
          </button>
        )}
      </div>

      <div className="mb-2 space-y-2">
        <div
          className={clsx(
            'flex items-center gap-2 rounded-lg border px-2 py-1.5',
            dark ? 'border-gray-700 bg-gray-900/70' : 'border-slate-200 bg-white',
          )}
        >
          <IconSearch size={13} className={dark ? 'text-gray-500' : 'text-slate-400'} />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, river, state…"
            className={clsx(
              'min-w-0 flex-1 bg-transparent text-[12px] outline-none',
              dark ? 'text-gray-200 placeholder:text-gray-600' : 'text-slate-800 placeholder:text-slate-400',
            )}
          />
        </div>

        <div className="flex gap-1.5">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className={clsx(
              'min-w-0 flex-1 rounded-md border px-2 py-1 text-[10px] font-medium',
              dark
                ? 'border-gray-700 bg-gray-900 text-gray-300'
                : 'border-slate-200 bg-white text-slate-700',
            )}
            aria-label="Sort stations"
          >
            <option value="risk">Sort: risk</option>
            <option value="bank">Sort: % bank</option>
            <option value="name">Sort: name</option>
          </select>
          <select
            value={riverFilter}
            onChange={(e) => setRiverFilter(e.target.value)}
            className={clsx(
              'min-w-0 flex-1 rounded-md border px-2 py-1 text-[10px] font-medium',
              dark
                ? 'border-gray-700 bg-gray-900 text-gray-300'
                : 'border-slate-200 bg-white text-slate-700',
            )}
            aria-label="Filter by river"
          >
            {rivers.map((r) => (
              <option key={r} value={r}>
                {r === 'All' ? 'All rivers' : r}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap gap-1">
          {RISK_FILTERS.map((tier) => {
            const on = riskFilter === tier
            return (
              <button
                key={tier}
                type="button"
                onClick={() => setRiskFilter(tier)}
                className={clsx(
                  'rounded-full border px-2 py-0.5 text-[9px] font-semibold transition',
                  on
                    ? dark
                      ? 'border-sky-600 bg-sky-600 text-white'
                      : 'border-sky-700 bg-sky-700 text-white'
                    : dark
                      ? 'border-gray-700 text-gray-400 hover:border-gray-600'
                      : 'border-slate-200 text-slate-500 hover:border-slate-300',
                )}
              >
                {tier}
              </button>
            )
          })}
        </div>
      </div>

      <p className={clsx('mb-1.5 px-1 text-[10px]', dark ? 'text-gray-600' : 'text-slate-400')}>
        {filtered.length} of {stations.length} gauges
      </p>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {filtered.map(({ station: s, risk, pct, peekProb }) => {
          const c = RISK_COLOR[risk] || RISK_COLOR.Normal
          const isSelected = selected === s.id

          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s.id)}
              className={clsx(
                'w-full rounded-lg border px-3 py-2.5 text-left transition-all',
                isSelected
                  ? dark
                    ? 'border-blue-700/70 bg-blue-950/60 shadow-[0_0_0_1px_rgba(59,130,246,0.2)]'
                    : 'border-sky-300 bg-sky-50 shadow-sm'
                  : dark
                    ? 'border-transparent bg-gray-800/30 hover:border-gray-700/50 hover:bg-gray-800/60'
                    : 'border-slate-200 bg-slate-50 shadow-sm hover:border-slate-300 hover:bg-white',
              )}
            >
              <div className="flex items-center gap-2.5">
                <span className={clsx('h-2 w-2 shrink-0 rounded-full', c.dot)} />
                <span
                  className={clsx(
                    'truncate text-[13px] font-medium',
                    isSelected
                      ? dark
                        ? 'text-white'
                        : 'text-slate-900'
                      : dark
                        ? 'text-gray-200'
                        : 'text-slate-800',
                  )}
                >
                  {s.name}
                </span>
                {peekProb != null && peekProb >= 0.3 && (
                  <span
                    className={clsx(
                      'ml-auto shrink-0 rounded px-1 py-0.5 text-[9px] font-bold tabular-nums',
                      dark ? 'bg-orange-950/80 text-orange-300' : 'bg-orange-100 text-orange-800',
                    )}
                  >
                    {Math.round(peekProb * 100)}%
                  </span>
                )}
              </div>

              <div
                className={clsx(
                  'mt-0.5 pl-[18px] text-[11px]',
                  dark ? 'text-gray-500' : 'text-slate-500',
                )}
              >
                {s.river} &middot; {s.state}
              </div>

              {pct !== null && (
                <div className="mt-2 pl-[18px]">
                  <div className="mb-1 flex items-center justify-between text-[11px]">
                    <span className={dark ? 'text-gray-600' : 'text-slate-500'}>Bank level</span>
                    <span className={clsx('font-semibold tabular-nums', c.text)}>{pct}%</span>
                  </div>
                  <div
                    className={clsx(
                      'h-1 overflow-hidden rounded-full',
                      dark ? 'bg-gray-800' : 'bg-slate-200',
                    )}
                  >
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
        {filtered.length === 0 && (
          <p className={clsx('px-1 py-4 text-center text-[11px]', dark ? 'text-gray-500' : 'text-slate-500')}>
            No gauges match these filters.
          </p>
        )}
      </div>
    </div>
  )
}
