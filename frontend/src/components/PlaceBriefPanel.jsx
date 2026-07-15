import React, { useState } from 'react'
import clsx from 'clsx'
import { formatDistance } from '../lib/geo'
import {
  RISK_COLOR,
  RISK_LABEL,
  actionHint,
  placeRiskMessage,
} from '../lib/riskCopy'
import { IconActivity, IconLocate, IconX } from './Icons'
import GaugeChart from './GaugeChart'
import RainfallChart from './RainfallChart'

const LIGHT_BADGE = {
  Normal: 'bg-teal-50 text-teal-800 border-teal-200',
  Watch: 'bg-amber-50 text-amber-900 border-amber-200',
  Warning: 'bg-orange-50 text-orange-900 border-orange-200',
  Emergency: 'bg-red-50 text-red-900 border-red-200',
}

const DARK_BADGE = {
  Normal: 'bg-teal-950/70 text-teal-200 border-teal-800',
  Watch: 'bg-amber-950/70 text-amber-200 border-amber-800',
  Warning: 'bg-orange-950/70 text-orange-200 border-orange-800',
  Emergency: 'bg-red-950/70 text-red-200 border-red-800',
}

export default function PlaceBriefPanel({
  place,
  overallRisk,
  primaryStation,
  nearby,
  nearbySettlements = [],
  settlementsLoading = false,
  loading,
  liveReadings,
  theme = 'light',
  onClose,
  onSelectStation,
  onSelectPlace,
}) {
  const [showDetails, setShowDetails] = useState(false)
  const tier = overallRisk || 'Normal'
  const badge = (theme === 'dark' ? DARK_BADGE : LIGHT_BADGE)[tier]
  const horizons = primaryStation?.prediction?.horizons || {}
  const elevated = overallRisk && overallRisk !== 'Normal'

  return (
    <section
      className={clsx(
        'flex h-full min-h-0 flex-col overflow-hidden border shadow-xl',
        theme === 'dark'
          ? 'border-gray-700/80 bg-gray-900/95 text-gray-100'
          : 'border-slate-200/90 bg-white/95 text-slate-900',
        'rounded-t-2xl md:rounded-2xl',
      )}
    >
      <header
        className={clsx(
          'flex items-start justify-between gap-3 border-b px-4 py-3.5 shrink-0',
          theme === 'dark' ? 'border-gray-800' : 'border-slate-100',
        )}
      >
        <div className="min-w-0">
          <p
            className={clsx(
              'inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em]',
              theme === 'dark' ? 'text-sky-400/80' : 'text-sky-700',
            )}
          >
            {place.from_geolocation && <IconLocate size={11} />}
            {place.from_geolocation ? 'Near you' : 'Flood conditions'}
          </p>
          <h2 className="mt-1 truncate font-display text-xl font-semibold tracking-tight">
            {place.name}
          </h2>
          <p
            className={clsx(
              'mt-0.5 truncate text-xs',
              theme === 'dark' ? 'text-gray-400' : 'text-slate-500',
            )}
          >
            {place.display_name || 'Nigeria'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className={clsx(
            'inline-flex h-8 w-8 items-center justify-center rounded-lg border transition shrink-0',
            theme === 'dark'
              ? 'border-gray-700 text-gray-400 hover:bg-gray-800 hover:text-white'
              : 'border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-900',
          )}
          aria-label="Close place conditions"
        >
          <IconX size={14} />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {loading && (
          <div
            className={clsx(
              'flex items-center gap-2 text-xs',
              theme === 'dark' ? 'text-gray-400' : 'text-slate-500',
            )}
          >
            <span
              className={clsx(
                'h-3 w-3 rounded-full border-2 animate-spin',
                theme === 'dark'
                  ? 'border-gray-600 border-t-sky-400'
                  : 'border-slate-300 border-t-sky-600',
              )}
            />
            Checking nearby river gauges…
          </div>
        )}

        {!loading && overallRisk == null && (
          <p className={clsx('text-sm leading-relaxed', theme === 'dark' ? 'text-gray-300' : 'text-slate-600')}>
            No monitored river gauges within about 220 km of this place. Zoom the map or try a
            nearby city on a major river.
          </p>
        )}

        {overallRisk && (
          <>
            <div className={clsx('rounded-xl border px-3.5 py-3', badge)}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium opacity-80">72-hour outlook</span>
                <span
                  className="text-sm font-bold tracking-wide"
                  style={{ color: RISK_COLOR[tier] }}
                >
                  {RISK_LABEL[tier]}
                </span>
              </div>
              <p className="mt-2 text-[13px] leading-relaxed opacity-90">
                {placeRiskMessage(tier, place.name, primaryStation?.name)}
              </p>
              <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide opacity-70">
                {actionHint(tier)}
              </p>
            </div>

            {Object.keys(horizons).length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <IconActivity
                    size={13}
                    className={theme === 'dark' ? 'text-gray-500' : 'text-slate-400'}
                  />
                  <h3
                    className={clsx(
                      'text-[10px] font-semibold uppercase tracking-widest',
                      theme === 'dark' ? 'text-gray-500' : 'text-slate-500',
                    )}
                  >
                    Forecast near {primaryStation?.name}
                  </h3>
                </div>
                <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
                  {Object.entries(horizons).map(([h, v]) => (
                    <div
                      key={h}
                      className={clsx(
                        'rounded-lg border px-1.5 py-2 text-center',
                        theme === 'dark'
                          ? 'border-gray-800 bg-gray-950/50'
                          : 'border-slate-100 bg-slate-50',
                      )}
                    >
                      <div
                        className={clsx(
                          'text-[10px] font-semibold',
                          theme === 'dark' ? 'text-gray-400' : 'text-slate-500',
                        )}
                      >
                        {h}
                      </div>
                      <div
                        className="mt-0.5 text-base font-bold tabular-nums leading-none"
                        style={{ color: RISK_COLOR[v.risk_tier] || RISK_COLOR.Normal }}
                      >
                        {(v.flood_prob * 100).toFixed(0)}
                        <span className="text-[10px] font-normal opacity-60">%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {(settlementsLoading || nearbySettlements.length > 0) && (
          <div>
            <h3
              className={clsx(
                'mb-1 text-[10px] font-semibold uppercase tracking-widest',
                theme === 'dark' ? 'text-gray-500' : 'text-slate-500',
              )}
            >
              Neighbouring towns & villages
            </h3>
            <p
              className={clsx(
                'mb-2 text-[11px] leading-relaxed',
                theme === 'dark' ? 'text-gray-400' : 'text-slate-500',
              )}
            >
              {elevated
                ? 'These nearby settlements may also be affected by the same flood outlook.'
                : 'Communities within about 25 km that share the surrounding area.'}
            </p>

            {settlementsLoading && nearbySettlements.length === 0 && (
              <p className={clsx('text-xs', theme === 'dark' ? 'text-gray-500' : 'text-slate-400')}>
                Loading neighbouring settlements…
              </p>
            )}

            <ul className="space-y-1.5">
              {nearbySettlements.map((s) => (
                <li key={`${s.name}-${s.lat}-${s.lon}`}>
                  <button
                    type="button"
                    onClick={() =>
                      onSelectPlace?.({
                        name: s.name,
                        display_name: s.display_name || `${s.name}, Nigeria`,
                        lat: s.lat,
                        lon: s.lon,
                        bbox_lnglat: null,
                      })
                    }
                    className={clsx(
                      'flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs transition',
                      theme === 'dark'
                        ? 'border-gray-800 bg-gray-950/40 hover:border-gray-600'
                        : 'border-slate-100 bg-slate-50/80 hover:border-slate-300 hover:bg-white',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{s.name}</span>
                      <span
                        className={clsx(
                          'block truncate',
                          theme === 'dark' ? 'text-gray-500' : 'text-slate-400',
                        )}
                      >
                        {s.class}
                        {s.population
                          ? ` · pop. ${Number(s.population).toLocaleString()}`
                          : ''}
                      </span>
                    </span>
                    <span
                      className={clsx(
                        'shrink-0 tabular-nums',
                        theme === 'dark' ? 'text-gray-400' : 'text-slate-500',
                      )}
                    >
                      {formatDistance(s.distance_km)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {overallRisk && nearby.length > 0 && (
          <div>
            <h3
              className={clsx(
                'mb-2 text-[10px] font-semibold uppercase tracking-widest',
                theme === 'dark' ? 'text-gray-500' : 'text-slate-500',
              )}
            >
              Nearby gauges
            </h3>
            <ul className="space-y-1.5">
              {nearby.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => onSelectStation?.(s.id)}
                    className={clsx(
                      'flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs transition',
                      theme === 'dark'
                        ? 'border-gray-800 bg-gray-950/40 hover:border-gray-600'
                        : 'border-slate-100 bg-slate-50/80 hover:border-slate-300 hover:bg-white',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{s.name}</span>
                      <span
                        className={clsx(
                          'block truncate',
                          theme === 'dark' ? 'text-gray-500' : 'text-slate-400',
                        )}
                      >
                        {s.river} · {formatDistance(s.distance_km)}
                      </span>
                    </span>
                    <span
                      className="shrink-0 font-semibold"
                      style={{ color: RISK_COLOR[s.overall_risk] }}
                    >
                      {RISK_LABEL[s.overall_risk]}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {overallRisk && (
          <>
            <p
              className={clsx(
                'rounded-lg border border-dashed px-3 py-2 text-[11px] leading-relaxed',
                theme === 'dark'
                  ? 'border-gray-700 text-gray-400'
                  : 'border-slate-200 text-slate-500',
              )}
            >
              Detailed flood extent (inundation) maps for this place are being prepared. Until then,
              use gauge forecasts and local advisories as your guide.
            </p>

            {primaryStation && (
              <button
                type="button"
                onClick={() => setShowDetails((v) => !v)}
                className={clsx(
                  'text-xs font-semibold underline-offset-2 hover:underline',
                  theme === 'dark' ? 'text-sky-400' : 'text-sky-700',
                )}
              >
                {showDetails ? 'Hide water & rainfall charts' : 'Show water & rainfall charts'}
              </button>
            )}

            {showDetails && primaryStation && (
              <div className="space-y-4">
                <GaugeChart
                  stationId={primaryStation.id}
                  liveReading={liveReadings?.[primaryStation.id]}
                  theme={theme}
                />
                <RainfallChart
                  stationId={primaryStation.id}
                  stationName={primaryStation.name}
                  theme={theme}
                />
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
