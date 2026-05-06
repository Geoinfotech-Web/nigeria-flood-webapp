import React, { useState } from 'react'
import clsx from 'clsx'
import { IconChevronDown, IconChevronUp } from './Icons'

export default function ImpactSummaryPanel({ summary = null, theme = 'dark' }) {
  const [collapsed, setCollapsed] = useState(false)

  if (!summary) return null

  return (
    <div
      className={clsx(
        'overflow-hidden rounded-xl border shadow-2xl',
        theme === 'dark' ? 'bg-gray-900 border-gray-700/90' : 'bg-white border-slate-200'
      )}
    >
      <button
        type="button"
        onClick={() => setCollapsed(current => !current)}
        className={clsx(
          'flex w-full items-center justify-between gap-3 border-b px-4 py-3 text-left transition',
          theme === 'dark' ? 'border-gray-800/90 hover:bg-gray-800/40' : 'border-slate-200 hover:bg-slate-50'
        )}
        aria-label={collapsed ? 'Expand impact analysis panel' : 'Collapse impact analysis panel'}
        title={collapsed ? 'Expand' : 'Collapse'}
      >
        <div>
          <p className={clsx('text-[10px] font-semibold uppercase tracking-widest', theme === 'dark' ? 'text-gray-500' : 'text-slate-500')}>
            Impact Analysis
          </p>
          <p className={clsx('mt-0.5 text-[10px]', theme === 'dark' ? 'text-gray-600' : 'text-slate-500')}>
            {summary.context?.label || 'Exposure intersections inside active flood zones'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={clsx('text-[10px]', theme === 'dark' ? 'text-gray-500' : 'text-slate-500')}>
            {summary.tiers?.join(' + ')}
          </span>
          <span className={theme === 'dark' ? 'text-gray-500' : 'text-slate-500'}>
            {collapsed ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />}
          </span>
        </div>
      </button>

      {!collapsed && (
        <div className="space-y-3 p-4">
          {summary.note && (
            <div className={clsx('rounded-lg border px-3 py-2', theme === 'dark' ? 'border-amber-900/60 bg-amber-950/30' : 'border-amber-200 bg-amber-50')}>
              <p className={clsx('text-[11px] leading-tight', theme === 'dark' ? 'text-amber-200/90' : 'text-amber-700')}>
                {summary.note}
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
            {[
              ['Roads', summary.roads?.total ?? 0, `${(summary.roads?.by_class?.Highway ?? 0).toLocaleString()} highways`],
              ['Bridges', summary.bridges?.total ?? 0, 'crossing points'],
              ['Settlements', summary.settlements?.total ?? 0, `${(summary.settlements?.by_class?.City ?? 0).toLocaleString()} cities`],
              ['Risk Zones', Object.values(summary.zones || {}).reduce((acc, count) => acc + count, 0), `${(summary.zones?.Warning ?? 0)} warning, ${(summary.zones?.Emergency ?? 0)} emergency, ${(summary.zones?.Watch ?? 0)} watch`],
            ].map(([label, value, detail]) => (
              <div
                key={label}
                className={clsx(
                  'rounded-lg border px-3 py-3',
                  theme === 'dark' ? 'border-gray-800 bg-gray-800/40' : 'border-slate-200 bg-slate-50'
                )}
              >
                <div className={clsx('text-[10px] uppercase tracking-wide', theme === 'dark' ? 'text-gray-500' : 'text-slate-500')}>{label}</div>
                <div className={clsx('mt-1 text-xl font-semibold', theme === 'dark' ? 'text-white' : 'text-slate-900')}>{value}</div>
                <div className={clsx('mt-1 text-[11px]', theme === 'dark' ? 'text-gray-500' : 'text-slate-500')}>{detail}</div>
              </div>
            ))}
          </div>

          {!!summary.settlements?.top_places?.length && (
            <div className="space-y-2">
              <p className={clsx('text-[10px] font-semibold uppercase tracking-widest', theme === 'dark' ? 'text-gray-500' : 'text-slate-500')}>
                Top Exposed Settlements
              </p>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
                {summary.settlements.top_places.map(place => (
                  <div
                    key={`${place.name}-${place.class}`}
                    className={clsx(
                      'rounded-lg border px-3 py-2.5',
                      theme === 'dark' ? 'border-gray-800 bg-gray-800/30' : 'border-slate-200 bg-slate-50'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={clsx('truncate text-[11px] font-medium', theme === 'dark' ? 'text-gray-200' : 'text-slate-800')}>
                        {place.name}
                      </span>
                      <span className={clsx('text-[10px]', theme === 'dark' ? 'text-gray-500' : 'text-slate-500')}>
                        {place.class}
                      </span>
                    </div>
                    <div className={clsx('mt-1 flex items-center justify-between gap-2 text-[10px]', theme === 'dark' ? 'text-gray-500' : 'text-slate-500')}>
                      <span>{place.risk_tier}</span>
                      <span>{place.population ? place.population.toLocaleString() : 'Population n/a'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
