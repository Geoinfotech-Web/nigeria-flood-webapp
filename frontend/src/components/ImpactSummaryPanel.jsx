import React, { useState } from 'react'
import clsx from 'clsx'
import { IconChevronDown, IconChevronUp } from './Icons'

const KPI_ACCENT = {
  Roads: {
    dark: 'border-sky-800/50 bg-sky-950/35',
    light: 'border-sky-200 bg-sky-50/90',
    valueDark: 'text-sky-300',
    valueLight: 'text-sky-800',
    bar: 'bg-sky-500',
  },
  Bridges: {
    dark: 'border-violet-800/50 bg-violet-950/35',
    light: 'border-violet-200 bg-violet-50/90',
    valueDark: 'text-violet-300',
    valueLight: 'text-violet-800',
    bar: 'bg-violet-500',
  },
  Settlements: {
    dark: 'border-amber-800/50 bg-amber-950/35',
    light: 'border-amber-200 bg-amber-50/90',
    valueDark: 'text-amber-300',
    valueLight: 'text-amber-800',
    bar: 'bg-amber-500',
  },
  'Risk Zones': {
    dark: 'border-rose-800/50 bg-rose-950/35',
    light: 'border-rose-200 bg-rose-50/90',
    valueDark: 'text-rose-300',
    valueLight: 'text-rose-800',
    bar: 'bg-rose-500',
  },
}

function KpiCard({ label, value, detail, theme, accent }) {
  const dark = theme === 'dark'
  return (
    <div
      className={clsx(
        'relative min-w-0 overflow-hidden rounded-xl border px-3 py-2.5 shadow-sm',
        dark ? accent.dark : accent.light,
      )}
    >
      <div className={clsx('absolute inset-y-0 left-0 w-1', accent.bar)} aria-hidden />
      <p
        className={clsx(
          'pl-1.5 text-[10px] font-semibold uppercase tracking-[0.12em]',
          dark ? 'text-gray-400' : 'text-slate-500',
        )}
      >
        {label}
      </p>
      <p
        className={clsx(
          'mt-0.5 pl-1.5 font-display text-2xl font-semibold tabular-nums leading-none tracking-tight sm:text-3xl',
          dark ? accent.valueDark : accent.valueLight,
        )}
      >
        {Number(value).toLocaleString()}
      </p>
      <p
        className={clsx(
          'mt-1.5 truncate pl-1.5 text-[10px] leading-tight',
          dark ? 'text-gray-500' : 'text-slate-500',
        )}
        title={detail}
      >
        {detail}
      </p>
    </div>
  )
}

export default function ImpactSummaryPanel({ summary = null, theme = 'dark' }) {
  const [placesOpen, setPlacesOpen] = useState(false)
  const dark = theme === 'dark'

  if (!summary) return null

  const zoneTotal = Object.values(summary.zones || {}).reduce((acc, count) => acc + count, 0)
  const kpis = [
    {
      label: 'Roads',
      value: summary.roads?.total ?? 0,
      detail: `${(summary.roads?.by_class?.Highway ?? 0).toLocaleString()} highways`,
    },
    {
      label: 'Bridges',
      value: summary.bridges?.total ?? 0,
      detail: 'crossing points in flood zones',
    },
    {
      label: 'Settlements',
      value: summary.settlements?.total ?? 0,
      detail: `${(summary.settlements?.by_class?.City ?? 0).toLocaleString()} cities exposed`,
    },
    {
      label: 'Risk Zones',
      value: zoneTotal,
      detail: [
        summary.zones?.Emergency ? `${summary.zones.Emergency} emergency` : null,
        summary.zones?.Warning ? `${summary.zones.Warning} warning` : null,
        summary.zones?.Watch ? `${summary.zones.Watch} watch` : null,
      ]
        .filter(Boolean)
        .join(' · ') || 'active flood extents',
    },
  ]

  const topPlaces = summary.settlements?.top_places || []

  return (
    <div
      className={clsx(
        'rounded-2xl border p-3 shadow-2xl backdrop-blur-md',
        dark ? 'border-gray-700/80 bg-gray-950/85' : 'border-slate-200/90 bg-white/90',
      )}
    >
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p
            className={clsx(
              'text-[10px] font-semibold uppercase tracking-widest',
              dark ? 'text-gray-500' : 'text-slate-500',
            )}
          >
            Impact Analysis
          </p>
          <p className={clsx('truncate text-[11px]', dark ? 'text-gray-400' : 'text-slate-600')}>
            {summary.context?.label || 'Exposure inside active flood zones'}
          </p>
        </div>
        <span
          className={clsx(
            'shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-medium',
            dark ? 'border-gray-700 text-gray-400' : 'border-slate-200 text-slate-500',
          )}
        >
          {(summary.tiers || []).join(' · ') || 'Watch+'}
        </span>
      </div>

      {summary.note && (
        <p
          className={clsx(
            'mb-2.5 rounded-lg border px-2.5 py-1.5 text-[11px] leading-snug',
            dark
              ? 'border-amber-900/50 bg-amber-950/40 text-amber-200/90'
              : 'border-amber-200 bg-amber-50 text-amber-800',
          )}
        >
          {summary.note}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <KpiCard
            key={kpi.label}
            label={kpi.label}
            value={kpi.value}
            detail={kpi.detail}
            theme={theme}
            accent={KPI_ACCENT[kpi.label]}
          />
        ))}
      </div>

      {!!topPlaces.length && (
        <div className="mt-2.5">
          <button
            type="button"
            onClick={() => setPlacesOpen((v) => !v)}
            className={clsx(
              'inline-flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition',
              dark
                ? 'border-gray-800 bg-gray-900/60 text-gray-300 hover:bg-gray-800/70'
                : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100',
            )}
            aria-expanded={placesOpen}
          >
            <span>
              {placesOpen ? 'Hide' : 'Show'} top exposed settlements ({topPlaces.length})
            </span>
            {placesOpen ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />}
          </button>

          {placesOpen && (
            <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-5">
              {topPlaces.map((place) => (
                <div
                  key={`${place.name}-${place.class}`}
                  className={clsx(
                    'rounded-lg border px-2.5 py-2',
                    dark ? 'border-gray-800 bg-gray-900/50' : 'border-slate-200 bg-slate-50',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={clsx(
                        'truncate text-[11px] font-medium',
                        dark ? 'text-gray-200' : 'text-slate-800',
                      )}
                    >
                      {place.name}
                    </span>
                    <span className={clsx('text-[10px]', dark ? 'text-gray-500' : 'text-slate-500')}>
                      {place.class}
                    </span>
                  </div>
                  <div
                    className={clsx(
                      'mt-0.5 flex items-center justify-between gap-2 text-[10px]',
                      dark ? 'text-gray-500' : 'text-slate-500',
                    )}
                  >
                    <span>{place.risk_tier}</span>
                    <span>
                      {place.population ? place.population.toLocaleString() : 'Pop. n/a'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
