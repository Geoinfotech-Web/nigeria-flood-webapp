import React, { useEffect, useState } from 'react'
import clsx from 'clsx'
import { formatDistance } from '../lib/geo'
import {
  RISK_COLOR,
  RISK_LABEL,
  SUSCEPTIBILITY_COLOR,
  SUSCEPTIBILITY_TEXT_COLOR,
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
  localSettlementSummary = null,
  settlementsLoading = false,
  nearbyRoads = [],
  roadSummary = null,
  roadsLoading = false,
  selectedRoad = null,
  onSelectRoad,
  nearbyBuildings = [],
  buildingSummary = null,
  buildingsLoading = false,
  buildingsError = null,
  loading,
  liveReadings,
  theme = 'light',
  onClose,
  onSelectStation,
  onSelectPlace,
  onPanelTabChange,
}) {
  const [showDetails, setShowDetails] = useState(false)
  const [panelTab, setPanelTab] = useState('places') // places | roads | buildings
  const tier = overallRisk || 'Normal'
  const badge = (theme === 'dark' ? DARK_BADGE : LIGHT_BADGE)[tier]
  const horizons = primaryStation?.prediction?.horizons || {}
  const elevated = overallRisk && overallRisk !== 'Normal'
  const highlyLikely = localSettlementSummary?.highly_likely ?? 0
  const highlySusceptible = localSettlementSummary?.highly_susceptible ?? 0
  const bySusceptibility = localSettlementSummary?.by_susceptibility || {}

  useEffect(() => {
    setPanelTab('places')
    setShowDetails(false)
  }, [place?.lat, place?.lon, place?.name])

  useEffect(() => {
    onPanelTabChange?.(panelTab)
  }, [panelTab, onPanelTabChange])

  const selectTab = (id) => {
    setPanelTab(id)
    onPanelTabChange?.(id)
  }

  const roadKey = (r) => `${r.osm_id || r.name}-${r.lat}-${r.lon}`
  const placesCount = nearbySettlements.length
  const roadsCount = nearbyRoads.length
  const roadsAtRisk = roadSummary?.at_risk ?? 0
  const buildingsExposed = buildingSummary?.exposed_in_flood_zones ?? 0
  const buildingsTotal = buildingSummary?.total_in_radius ?? nearbyBuildings.length
  const buildingsScope = buildingSummary?.scope === 'map_viewport' ? 'map view' : 'near place'

  const tabBtn = (id, label, count, loadingTab) => (
    <button
      type="button"
      role="tab"
      aria-selected={panelTab === id}
      onClick={() => selectTab(id)}
      className={clsx(
        'min-w-0 flex-1 rounded-lg px-1.5 py-2 text-left transition sm:px-2.5',
        panelTab === id
          ? theme === 'dark'
            ? 'bg-gray-800 text-white shadow-sm'
            : 'bg-white text-slate-900 shadow-sm'
          : theme === 'dark'
            ? 'text-gray-400 hover:text-gray-200'
            : 'text-slate-500 hover:text-slate-800',
      )}
    >
      <span className="block truncate text-[9px] font-semibold uppercase tracking-wider sm:text-[10px]">
        {label}
      </span>
      <span className="mt-0.5 block truncate text-[11px] font-medium tabular-nums sm:text-xs">
        {loadingTab ? '…' : count}
      </span>
    </button>
  )
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

        <div>
          <div
            role="tablist"
            aria-label="Nearby places, roads, and buildings"
            className={clsx(
              'mb-3 flex gap-1 rounded-xl border p-1',
              theme === 'dark' ? 'border-gray-800 bg-gray-950/50' : 'border-slate-200 bg-slate-100/80',
            )}
          >
            {tabBtn('places', 'Towns', placesCount, settlementsLoading)}
            {tabBtn(
              'roads',
              'Roads',
              roadsAtRisk > 0 ? `${roadsAtRisk} risk` : roadsCount,
              roadsLoading,
            )}
            {tabBtn(
              'buildings',
              'Buildings',
              buildingsLoading ? '…' : buildingsExposed,
              buildingsLoading,
            )}
          </div>

          {panelTab === 'places' && (
            <div className="space-y-3">
              {localSettlementSummary && nearbySettlements.length > 0 && (
                <div
                  className={clsx(
                    'rounded-xl border px-3.5 py-3',
                    highlySusceptible > 0 || highlyLikely > 0
                      ? theme === 'dark'
                        ? 'border-orange-800/50 bg-orange-950/30'
                        : 'border-orange-200 bg-orange-50'
                      : theme === 'dark'
                        ? 'border-gray-800 bg-gray-950/40'
                        : 'border-slate-200 bg-slate-50',
                  )}
                >
                  <p
                    className={clsx(
                      'text-[10px] font-semibold uppercase tracking-widest',
                      theme === 'dark' ? 'text-gray-400' : 'text-slate-500',
                    )}
                  >
                    Nearby impact · ~25 km
                  </p>
                  <p className="mt-1 text-[13px] font-semibold">
                    <span className="tabular-nums text-xl">{highlySusceptible || highlyLikely}</span>
                    {' '}of {localSettlementSummary.total} places in high / highly susceptible areas
                    {highlyLikely > 0 ? (
                      <span
                        className={clsx(
                          'mt-0.5 block text-[11px] font-normal',
                          theme === 'dark' ? 'text-gray-400' : 'text-slate-500',
                        )}
                      >
                        {highlyLikely} also on elevated gauge forecast (warning/emergency)
                      </span>
                    ) : null}
                  </p>
                  {(bySusceptibility['Highly Susceptible'] ||
                    bySusceptibility.High ||
                    bySusceptibility.Moderate ||
                    bySusceptibility.Low) ? (
                    <p
                      className={clsx(
                        'mt-1 text-[11px]',
                        theme === 'dark' ? 'text-gray-400' : 'text-slate-500',
                      )}
                    >
                      {[
                        bySusceptibility['Highly Susceptible']
                          ? `${bySusceptibility['Highly Susceptible']} highly susceptible`
                          : null,
                        bySusceptibility.High ? `${bySusceptibility.High} high` : null,
                        bySusceptibility.Moderate ? `${bySusceptibility.Moderate} moderate` : null,
                        bySusceptibility.Low ? `${bySusceptibility.Low} low` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  ) : null}
                </div>
              )}

              <p
                className={clsx(
                  'text-[11px] leading-relaxed',
                  theme === 'dark' ? 'text-gray-400' : 'text-slate-500',
                )}
              >
                Flood susceptibility at each place. Tap a name to focus the map there.
              </p>

              {settlementsLoading && nearbySettlements.length === 0 && (
                <p className={clsx('text-xs', theme === 'dark' ? 'text-gray-500' : 'text-slate-400')}>
                  Loading neighbouring settlements…
                </p>
              )}

              {!settlementsLoading && nearbySettlements.length === 0 && (
                <p className={clsx('text-xs', theme === 'dark' ? 'text-gray-500' : 'text-slate-400')}>
                  No neighbouring towns or villages found nearby.
                </p>
              )}

              <ul className="space-y-1.5">
                {nearbySettlements.map((s) => {
                  const sus = s.susceptibility
                  const susColor = SUSCEPTIBILITY_COLOR[sus]
                  const susText = SUSCEPTIBILITY_TEXT_COLOR[sus]
                  const gaugeElevated = s.risk_tier && s.risk_tier !== 'Normal'
                  return (
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
                            {s.class} · {formatDistance(s.distance_km)}
                            {s.nearest_gauge ? ` · via ${s.nearest_gauge}` : ''}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          {sus ? (
                            <span
                              className="inline-flex items-center justify-end gap-1.5 font-semibold"
                              style={{ color: susText }}
                            >
                              <span
                                className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm border border-black/10"
                                style={{ backgroundColor: susColor }}
                                aria-hidden
                              />
                              {sus}
                            </span>
                          ) : (
                            <span
                              className={clsx(
                                'font-medium',
                                theme === 'dark' ? 'text-gray-500' : 'text-slate-400',
                              )}
                            >
                              Unclassified
                            </span>
                          )}
                          {gaugeElevated ? (
                            <span
                              className="mt-0.5 block text-[10px] font-medium"
                              style={{ color: RISK_COLOR[s.risk_tier] }}
                            >
                              {RISK_LABEL[s.risk_tier] || s.risk_tier}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {panelTab === 'roads' && (
            <div className="space-y-3">
              <p
                className={clsx(
                  'text-[11px] leading-relaxed',
                  theme === 'dark' ? 'text-gray-400' : 'text-slate-500',
                )}
              >
                Major roads within ~{roadSummary?.radius_km ?? 12} km with Moderate+ flood
                susceptibility. Tap a road to highlight it on the map. Residential streets are not
                included.
              </p>

              {roadsLoading && nearbyRoads.length === 0 && (
                <p className={clsx('text-xs', theme === 'dark' ? 'text-gray-500' : 'text-slate-400')}>
                  Checking roads near this location…
                </p>
              )}

              {!roadsLoading && nearbyRoads.length === 0 && (
                <p className={clsx('text-xs', theme === 'dark' ? 'text-gray-500' : 'text-slate-400')}>
                  No moderate-or-higher susceptibility roads found nearby among mapped highways and
                  major routes.
                </p>
              )}

              {roadSummary && nearbyRoads.length > 0 && (
                <p
                  className={clsx(
                    'text-[11px]',
                    theme === 'dark' ? 'text-gray-400' : 'text-slate-500',
                  )}
                >
                  {(roadSummary.at_risk ?? 0) > 0
                    ? `${roadSummary.at_risk} high / highly susceptible`
                    : 'None at high susceptibility'}
                  {roadSummary.by_susceptibility?.Moderate
                    ? ` · ${roadSummary.by_susceptibility.Moderate} moderate`
                    : ''}
                  {' · '}
                  showing {nearbyRoads.length}
                </p>
              )}

              <ul className="space-y-1.5">
                {nearbyRoads.map((r) => {
                  const sus = r.susceptibility
                  const susColor = SUSCEPTIBILITY_COLOR[sus]
                  const susText = SUSCEPTIBILITY_TEXT_COLOR[sus]
                  const key = roadKey(r)
                  const active =
                    selectedRoad &&
                    (selectedRoad.osm_id
                      ? selectedRoad.osm_id === r.osm_id
                      : roadKey(selectedRoad) === key)
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        onClick={() => onSelectRoad?.(active ? null : r)}
                        className={clsx(
                          'flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs transition',
                          active
                            ? theme === 'dark'
                              ? 'border-sky-500 bg-sky-950/40 ring-1 ring-sky-500/40'
                              : 'border-sky-400 bg-sky-50 ring-1 ring-sky-300'
                            : theme === 'dark'
                              ? 'border-gray-800 bg-gray-950/40 hover:border-gray-600'
                              : 'border-slate-100 bg-slate-50/80 hover:border-slate-300 hover:bg-white',
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{r.name}</span>
                          <span
                            className={clsx(
                              'block truncate',
                              theme === 'dark' ? 'text-gray-500' : 'text-slate-400',
                            )}
                          >
                            {r.class}
                            {r.bridge ? ' · bridge' : ''}
                            {' · '}
                            {formatDistance(r.distance_km)}
                            {active ? ' · on map' : ''}
                          </span>
                        </span>
                        {sus ? (
                          <span
                            className="inline-flex shrink-0 items-center gap-1.5 font-semibold"
                            style={{ color: susText }}
                          >
                            <span
                              className="inline-block h-2.5 w-2.5 rounded-sm border border-black/10"
                              style={{ backgroundColor: susColor }}
                              aria-hidden
                            />
                            {sus}
                          </span>
                        ) : (
                          <span
                            className={clsx(
                              'shrink-0 font-medium',
                              theme === 'dark' ? 'text-gray-500' : 'text-slate-400',
                            )}
                          >
                            Unclassified
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {panelTab === 'buildings' && (
            <div className="space-y-3">
              <div
                className={clsx(
                  'rounded-xl border px-3.5 py-3',
                  buildingsExposed > 0 || (buildingSummary?.high_susceptibility ?? 0) > 0
                    ? theme === 'dark'
                      ? 'border-violet-800/50 bg-violet-950/30'
                      : 'border-violet-200 bg-violet-50'
                    : theme === 'dark'
                      ? 'border-gray-800 bg-gray-950/40'
                      : 'border-slate-200 bg-slate-50',
                )}
              >
                <p
                  className={clsx(
                    'text-[10px] font-semibold uppercase tracking-widest',
                    theme === 'dark' ? 'text-gray-400' : 'text-slate-500',
                  )}
                >
                  Buildings · zones & susceptibility · {buildingsScope}
                </p>
                <p className="mt-1 text-[13px] font-semibold">
                  <span className="tabular-nums text-xl">{buildingsExposed}</span>
                  {' '}of {buildingsTotal || '—'} in Watch / Warning / Emergency zones
                </p>
                {buildingSummary?.by_zone_tier && (
                  <p
                    className={clsx(
                      'mt-1 text-[11px]',
                      theme === 'dark' ? 'text-gray-400' : 'text-slate-500',
                    )}
                  >
                    {[
                      buildingSummary.by_zone_tier.Emergency
                        ? `${buildingSummary.by_zone_tier.Emergency} emergency`
                        : null,
                      buildingSummary.by_zone_tier.Warning
                        ? `${buildingSummary.by_zone_tier.Warning} warning`
                        : null,
                      buildingSummary.by_zone_tier.Watch
                        ? `${buildingSummary.by_zone_tier.Watch} watch`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'No zone overlaps'}
                  </p>
                )}
                {buildingSummary?.by_susceptibility && (
                  <p
                    className={clsx(
                      'mt-1.5 text-[11px]',
                      theme === 'dark' ? 'text-gray-400' : 'text-slate-500',
                    )}
                  >
                    Susceptibility
                    {buildingSummary.susceptibility_sample_size
                      ? ` (${buildingSummary.susceptibility_sample_size} sampled)`
                      : ''}
                    :{' '}
                    {[
                      buildingSummary.by_susceptibility['Highly Susceptible']
                        ? `${buildingSummary.by_susceptibility['Highly Susceptible']} highly`
                        : null,
                      buildingSummary.by_susceptibility.High
                        ? `${buildingSummary.by_susceptibility.High} high`
                        : null,
                      buildingSummary.by_susceptibility.Moderate
                        ? `${buildingSummary.by_susceptibility.Moderate} moderate`
                        : null,
                      buildingSummary.by_susceptibility.Low
                        ? `${buildingSummary.by_susceptibility.Low} low`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || 'Unclassified'}
                  </p>
                )}
              </div>

              <p
                className={clsx(
                  'text-[11px] leading-relaxed',
                  theme === 'dark' ? 'text-gray-400' : 'text-slate-500',
                )}
              >
                Each building is classified Low → Highly Susceptible (same as the flood
                susceptibility map), plus zone exposure. Pan or zoom to refresh. Tap a row to
                highlight on the map.
              </p>

              {buildingSummary?.note && (
                <p
                  className={clsx(
                    'text-[11px] leading-relaxed',
                    theme === 'dark' ? 'text-amber-200/80' : 'text-amber-800',
                  )}
                >
                  {buildingSummary.note}
                </p>
              )}

              {buildingsLoading && (
                <p className={clsx('text-xs', theme === 'dark' ? 'text-gray-500' : 'text-slate-400')}>
                  Loading buildings & classifying susceptibility…
                </p>
              )}

              {buildingsError && !buildingsLoading && (
                <p className={clsx('text-xs', theme === 'dark' ? 'text-red-300' : 'text-red-600')}>
                  Could not load buildings (
                  {buildingsError.response?.data?.detail ||
                    buildingsError.message ||
                    'network error'}
                  ). Try again or zoom the map Buildings layer.
                </p>
              )}

              {!buildingsLoading && !buildingsError && nearbyBuildings.length === 0 && (
                <p className={clsx('text-xs', theme === 'dark' ? 'text-gray-500' : 'text-slate-400')}>
                  No OSM buildings found within ~{buildingSummary?.radius_km ?? 3} km (coverage
                  varies by area).
                </p>
              )}

              <ul className="space-y-1.5">
                {nearbyBuildings.map((b) => {
                  const key = `${b.osm_id || b.name}-${b.lat}-${b.lon}`
                  const active =
                    selectedRoad &&
                    (selectedRoad.osm_id
                      ? selectedRoad.osm_id === b.osm_id
                      : roadKey(selectedRoad) === key)
                  const sus = b.susceptibility
                  const susColor = SUSCEPTIBILITY_COLOR[sus]
                  const susText = SUSCEPTIBILITY_TEXT_COLOR[sus]
                  const exposed = Boolean(b.exposed || b.zone_tier)
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        onClick={() =>
                          onSelectRoad?.(
                            active
                              ? null
                              : {
                                  ...b,
                                  name: b.name || `${b.class || 'Building'}`,
                                  coordinates: null,
                                },
                          )
                        }
                        className={clsx(
                          'flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs transition',
                          active
                            ? theme === 'dark'
                              ? 'border-violet-500 bg-violet-950/40 ring-1 ring-violet-500/40'
                              : 'border-violet-400 bg-violet-50 ring-1 ring-violet-300'
                            : theme === 'dark'
                              ? 'border-gray-800 bg-gray-950/40 hover:border-gray-600'
                              : 'border-slate-100 bg-slate-50/80 hover:border-slate-300 hover:bg-white',
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {b.name || `${b.class || 'Building'}`}
                          </span>
                          <span
                            className={clsx(
                              'block truncate',
                              theme === 'dark' ? 'text-gray-500' : 'text-slate-400',
                            )}
                          >
                            {b.class || 'Building'}
                            {b.distance_km != null ? ` · ${formatDistance(b.distance_km)}` : ''}
                            {exposed
                              ? ` · ${RISK_LABEL[b.zone_tier] || b.zone_tier}`
                              : ' · outside zone'}
                            {active ? ' · on map' : ''}
                          </span>
                        </span>
                        {sus ? (
                          <span
                            className="inline-flex shrink-0 items-center gap-1.5 font-semibold"
                            style={{ color: susText }}
                          >
                            <span
                              className="inline-block h-2.5 w-2.5 rounded-sm border border-black/10"
                              style={{ backgroundColor: susColor }}
                              aria-hidden
                            />
                            {sus}
                          </span>
                        ) : (
                          <span
                            className={clsx(
                              'shrink-0 font-medium',
                              theme === 'dark' ? 'text-gray-500' : 'text-slate-400',
                            )}
                          >
                            Unclassified
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>

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
              Toggle Inundation probability or Inundation history on the map. Gauge forecasts
              remain the primary early-warning guide.
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
