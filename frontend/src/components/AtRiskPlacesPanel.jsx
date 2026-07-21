import React from 'react'
import clsx from 'clsx'
import { IconSearch, IconX } from './Icons'

const RISK_FILTERS = ['All', 'Emergency', 'Warning', 'Watch']

const RISK_COLOR = {
  Watch: { dot: 'bg-yellow-400', text: 'text-yellow-400', badge: 'bg-yellow-950/40 border-yellow-800 text-yellow-300' },
  Warning: { dot: 'bg-orange-400', text: 'text-orange-400', badge: 'bg-orange-950/40 border-orange-800 text-orange-300' },
  Emergency: { dot: 'bg-red-400 animate-pulse', text: 'text-red-400', badge: 'bg-red-950/40 border-red-800 text-red-300' },
}

function selectClass(dark) {
  return clsx(
    'min-w-0 flex-1 rounded-md border px-2 py-1 text-[10px] font-medium',
    dark ? 'border-gray-700 bg-gray-900 text-gray-300' : 'border-slate-200 bg-white text-slate-700',
  )
}

export default function AtRiskPlacesPanel({
  summary = null,
  loading = false,
  selectedPlace = null,
  filters,
  onFiltersChange,
  onSelectPlace,
  onReset,
  theme = 'dark',
}) {
  const dark = theme === 'dark'
  const places = summary?.places || []
  const states = summary?.available_states || []
  const classes = summary?.available_classes || []

  return (
    <div className="flex h-full flex-col p-3">
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-2">
          <span className={clsx('h-2 w-2 rounded-full', dark ? 'bg-sky-400' : 'bg-sky-600')} />
          <p
            className={clsx(
              'text-[10px] font-semibold uppercase tracking-widest',
              dark ? 'text-gray-500' : 'text-slate-500',
            )}
          >
            At-risk places
          </p>
        </div>

        {(selectedPlace || filters.query || filters.state !== 'All' || filters.placeClass !== 'All' || filters.riskTier !== 'All') && (
          <button
            type="button"
            onClick={onReset}
            className={clsx(
              'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium transition',
              dark
                ? 'border-gray-700/70 bg-gray-800/60 text-gray-300 hover:border-gray-600 hover:bg-gray-800 hover:text-white'
                : 'border-slate-200 bg-slate-100 text-slate-600 hover:border-slate-300 hover:bg-white hover:text-slate-900',
            )}
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
            value={filters.query}
            onChange={(e) => onFiltersChange({ query: e.target.value })}
            placeholder="Search place, station, state…"
            className={clsx(
              'min-w-0 flex-1 bg-transparent text-[12px] outline-none',
              dark ? 'text-gray-200 placeholder:text-gray-600' : 'text-slate-800 placeholder:text-slate-400',
            )}
          />
        </div>

        <div className="flex gap-1.5">
          <select
            value={filters.state}
            onChange={(e) => onFiltersChange({ state: e.target.value })}
            className={selectClass(dark)}
            aria-label="Filter by state"
          >
            <option value="All">All states</option>
            {states.map((state) => (
              <option key={state} value={state}>
                {state}
              </option>
            ))}
          </select>
          <select
            value={filters.placeClass}
            onChange={(e) => onFiltersChange({ placeClass: e.target.value })}
            className={selectClass(dark)}
            aria-label="Filter by place class"
          >
            <option value="All">All classes</option>
            {classes.map((placeClass) => (
              <option key={placeClass} value={placeClass}>
                {placeClass}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap gap-1">
          {RISK_FILTERS.map((tier) => {
            const on = filters.riskTier === tier
            return (
              <button
                key={tier}
                type="button"
                onClick={() => onFiltersChange({ riskTier: tier })}
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

      <div className="mb-1.5 flex items-center justify-between px-1 text-[10px]">
        <span className={dark ? 'text-gray-600' : 'text-slate-400'}>
          {loading ? 'Loading places…' : `${summary?.returned ?? places.length} of ${summary?.total ?? places.length} places`}
        </span>
        <span className={dark ? 'text-gray-600' : 'text-slate-400'}>
          {summary?.affected_state_count ?? 0} states
        </span>
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {!loading && places.map((place) => {
          const risk = place.station_risk_tier || 'Warning'
          const color = RISK_COLOR[risk] || RISK_COLOR.Warning
          const isSelected =
            selectedPlace &&
            selectedPlace.name === place.name &&
            Number(selectedPlace.lat) === Number(place.lat) &&
            Number(selectedPlace.lon) === Number(place.lon)

          return (
            <button
              key={`${place.name}-${place.lat}-${place.lon}`}
              type="button"
              onClick={() => onSelectPlace?.(place)}
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
                <span className={clsx('h-2 w-2 shrink-0 rounded-full', color.dot)} />
                <span className={clsx('truncate text-[13px] font-medium', dark ? 'text-gray-200' : 'text-slate-800')}>
                  {place.name}
                </span>
                <span
                  className={clsx(
                    'ml-auto shrink-0 rounded border px-1 py-0.5 text-[9px] font-bold',
                    color.badge,
                  )}
                >
                  {risk}
                </span>
              </div>

              <div className={clsx('mt-0.5 pl-[18px] text-[11px]', dark ? 'text-gray-500' : 'text-slate-500')}>
                {place.class}
                {place.state ? ` · ${place.state}` : ''}
              </div>

              <div className="mt-2 flex flex-wrap gap-1.5 pl-[18px]">
                {place.nearest_station ? (
                  <span className={clsx('rounded-full px-1.5 py-0.5 text-[9px]', dark ? 'bg-gray-900 text-gray-400' : 'bg-slate-100 text-slate-600')}>
                    via {place.nearest_station}
                  </span>
                ) : null}
                {place.susceptibility ? (
                  <span className={clsx('rounded-full px-1.5 py-0.5 text-[9px]', dark ? 'bg-fuchsia-950/40 text-fuchsia-300' : 'bg-fuchsia-50 text-fuchsia-800')}>
                    {place.susceptibility}
                  </span>
                ) : null}
                {place.distance_km != null ? (
                  <span className={clsx('rounded-full px-1.5 py-0.5 text-[9px]', dark ? 'bg-gray-900 text-gray-500' : 'bg-slate-100 text-slate-500')}>
                    {Number(place.distance_km).toFixed(1)} km
                  </span>
                ) : null}
              </div>
            </button>
          )
        })}

        {!loading && places.length === 0 && (
          <p className={clsx('px-1 py-4 text-center text-[11px]', dark ? 'text-gray-500' : 'text-slate-500')}>
            No places match these filters.
          </p>
        )}
        {loading && (
          <p className={clsx('px-1 py-4 text-center text-[11px]', dark ? 'text-gray-500' : 'text-slate-500')}>
            Loading at-risk places…
          </p>
        )}
      </div>
    </div>
  )
}
