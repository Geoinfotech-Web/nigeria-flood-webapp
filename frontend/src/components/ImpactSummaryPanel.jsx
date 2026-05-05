import React, { useState } from 'react'
import { IconChevronDown, IconChevronUp } from './Icons'

export default function ImpactSummaryPanel({ summary = null }) {
  const [collapsed, setCollapsed] = useState(false)

  if (!summary) return null

  return (
    <div className="bg-gray-900/92 backdrop-blur border border-gray-700/80 rounded-xl shadow-2xl overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed(current => !current)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-800/90
                   text-left transition hover:bg-gray-800/40"
        aria-label={collapsed ? 'Expand impact analysis panel' : 'Collapse impact analysis panel'}
        title={collapsed ? 'Expand' : 'Collapse'}
      >
        <div>
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">
            Impact Analysis
          </p>
          <p className="text-[10px] text-gray-600 mt-0.5">
            {summary.context?.label || 'Exposure intersections inside active flood zones'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-gray-500">
            {summary.tiers?.join(' + ')}
          </span>
          <span className="text-gray-500">
            {collapsed ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />}
          </span>
        </div>
      </button>

      {!collapsed && (
        <div className="p-4 space-y-3">
          {summary.note && (
            <div className="rounded-lg border border-amber-900/60 bg-amber-950/30 px-3 py-2">
              <p className="text-[11px] leading-tight text-amber-200/90">
                {summary.note}
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
            <div className="rounded-lg border border-gray-800 bg-gray-800/40 px-3 py-3">
              <div className="text-[10px] text-gray-500 uppercase tracking-wide">Roads</div>
              <div className="text-xl font-semibold text-white mt-1">
                {summary.roads?.total ?? 0}
              </div>
              <div className="text-[11px] text-gray-500 mt-1">
                {(summary.roads?.by_class?.Highway ?? 0).toLocaleString()} highways
              </div>
            </div>

            <div className="rounded-lg border border-gray-800 bg-gray-800/40 px-3 py-3">
              <div className="text-[10px] text-gray-500 uppercase tracking-wide">Bridges</div>
              <div className="text-xl font-semibold text-white mt-1">
                {summary.bridges?.total ?? 0}
              </div>
              <div className="text-[11px] text-gray-500 mt-1">
                crossing points
              </div>
            </div>

            <div className="rounded-lg border border-gray-800 bg-gray-800/40 px-3 py-3">
              <div className="text-[10px] text-gray-500 uppercase tracking-wide">Settlements</div>
              <div className="text-xl font-semibold text-white mt-1">
                {summary.settlements?.total ?? 0}
              </div>
              <div className="text-[11px] text-gray-500 mt-1">
                {(summary.settlements?.by_class?.City ?? 0).toLocaleString()} cities
              </div>
            </div>

            <div className="rounded-lg border border-gray-800 bg-gray-800/40 px-3 py-3">
              <div className="text-[10px] text-gray-500 uppercase tracking-wide">Risk Zones</div>
              <div className="text-xl font-semibold text-white mt-1">
                {Object.values(summary.zones || {}).reduce((acc, count) => acc + count, 0)}
              </div>
              <div className="text-[11px] text-gray-500 mt-1">
                {(summary.zones?.Warning ?? 0)} warning, {(summary.zones?.Emergency ?? 0)} emergency, {(summary.zones?.Watch ?? 0)} watch
              </div>
            </div>
          </div>

          {!!summary.settlements?.top_places?.length && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">
                Top Exposed Settlements
              </p>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
                {summary.settlements.top_places.map(place => (
                  <div
                    key={`${place.name}-${place.class}`}
                    className="rounded-lg border border-gray-800 bg-gray-800/30 px-3 py-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium text-gray-200 truncate">
                        {place.name}
                      </span>
                      <span className="text-[10px] text-gray-500">
                        {place.class}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-1 text-[10px] text-gray-500">
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
