import React, { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { formatDistance } from '../lib/geo'
import { HORIZON_KEYS, normalizeHorizons } from '../lib/horizons'
import {
  RISK_COLOR,
  RISK_LABEL,
  SUSCEPTIBILITY_TEXT_COLOR,
  actionHint,
  placeRiskMessage,
} from '../lib/riskCopy'
import { exportIntelligenceReportPdf } from '../lib/exportIntelligenceReportPdf'
import { IconLocate, IconX } from './Icons'
import GenerateReportButton from './GenerateReportButton'

const SHEET_TABS = [
  { id: 'basic', label: 'Basic' },
  { id: 'places', label: 'Nearby' },
  { id: 'roads', label: 'Roads' },
  { id: 'buildings', label: 'Buildings' },
  { id: 'gauges', label: 'Gauges' },
]

function cellBg(tier, dark) {
  switch (tier) {
    case 'Emergency':
      return dark ? 'bg-red-950/80 text-red-200' : 'bg-red-100 text-red-900'
    case 'Warning':
      return dark ? 'bg-orange-950/70 text-orange-200' : 'bg-orange-100 text-orange-900'
    case 'Watch':
      return dark ? 'bg-amber-950/60 text-amber-200' : 'bg-amber-100 text-amber-900'
    default:
      return dark ? 'bg-teal-950/50 text-teal-200' : 'bg-teal-50 text-teal-900'
  }
}

/**
 * Windy-style full-width bottom forecast sheet for a selected map place.
 */
export default function PlaceForecastSheet({
  place,
  overallRisk,
  primaryStation,
  siteAssessment = null,
  nearby = [],
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
  loading = false,
  liveReadings,
  theme = 'light',
  onClose,
  onSelectStation,
  onSelectPlace,
  onPanelTabChange,
  captureMapSnapshot = null,
}) {
  const dark = theme === 'dark'
  const [sheetTab, setSheetTab] = useState('basic')
  const [exporting, setExporting] = useState(false)
  const tier = overallRisk || 'Normal'
  const horizons = useMemo(
    () => normalizeHorizons(primaryStation?.prediction?.horizons || {}),
    [primaryStation?.prediction?.horizons],
  )
  const horizonCols = useMemo(() => {
    const keys = HORIZON_KEYS.filter((k) => horizons[k])
    return keys.length ? keys : HORIZON_KEYS
  }, [horizons])

  const placesCount = nearbySettlements.length
  const roadsAtRisk = roadSummary?.at_risk ?? 0
  const buildingsExposed = buildingSummary?.exposed_in_flood_zones ?? 0
  const highlyLikely = localSettlementSummary?.highly_likely ?? 0
  const highlySusceptible = localSettlementSummary?.highly_susceptible ?? 0
  const urbanFlashZone = useMemo(
    () => (siteAssessment?.zones_inside || []).find((zone) => zone?.source === 'urban_flash_flood') || null,
    [siteAssessment?.zones_inside],
  )

  useEffect(() => {
    setSheetTab('basic')
  }, [place?.lat, place?.lon, place?.name])

  useEffect(() => {
    onPanelTabChange?.(sheetTab === 'buildings' ? 'buildings' : 'places')
  }, [sheetTab, onPanelTabChange])

  const reportSubtitle = place.from_geolocation
    ? 'Your location · public brief'
    : place.source === 'urban_flash_flood'
      ? 'Urban flash · public brief'
      : 'This place · public brief'

  const handleGenerateReport = async () => {
    if (!place || exporting) return
    setExporting(true)
    try {
      let mapImage = null
      try {
        mapImage = (await captureMapSnapshot?.()) || null
      } catch {
        mapImage = null
      }
      const message = placeRiskMessage(tier, place.name)
      const zonesInside = siteAssessment?.zones_inside || []
      const zonesNearby = siteAssessment?.zones_nearby || []
      const nearbyPlaceRiskCount = highlyLikely || highlySusceptible || 0
      const nearbyRoadRiskCount = roadsAtRisk
      const hasInundationHistory = [...zonesInside, ...zonesNearby].some(
        (zone) => zone?.source === 'sar_dem_inundation' || zone?.source === 'inundation_history',
      )
      const hasUrbanFlash = [...zonesInside, ...zonesNearby].some(
        (zone) => zone?.source === 'urban_flash_flood',
      )
      exportIntelligenceReportPdf({
        place,
        overallRisk: tier,
        primaryStation,
        terrain: null,
        site: siteAssessment,
        suitability: {
          verdict: message,
          verdictTier: tier,
          reasons: [
            place.from_geolocation
              ? 'Based on your current location.'
              : place.source === 'urban_flash_flood'
                ? `Urban flash flood area marked ${place.urban_flash_tier || 'Likely / Highly Likely'}.`
                : place.source === 'map_click'
                  ? 'Based on the map location you selected.'
                  : 'Based on the searched or selected place.',
            `Forecast status: ${RISK_LABEL[tier] || tier}.`,
            nearbyPlaceRiskCount > 0
              ? `${nearbyPlaceRiskCount} nearby place${nearbyPlaceRiskCount > 1 ? 's are' : ' is'} also in higher flood-risk conditions.`
              : null,
            nearbyRoadRiskCount > 0
              ? `${nearbyRoadRiskCount} nearby road${nearbyRoadRiskCount > 1 ? 's are' : ' is'} at elevated flood risk.`
              : null,
            hasInundationHistory
              ? 'Flood inundation has been mapped at or near this area before.'
              : null,
            hasUrbanFlash
              ? 'This area is also within or near an urban flash flood zone.'
              : null,
            actionHint(tier),
          ].filter(Boolean),
          uses: [],
        },
        actions: [actionHint(tier)],
        horizons,
        roads: nearbyRoads,
        settlements: nearbySettlements,
        gauges: nearby,
        mapImage,
        detailLevel: 'brief',
        briefMessage: message,
      })
    } finally {
      setExporting(false)
    }
  }

  const coords =
    Number.isFinite(Number(place.lat)) && Number.isFinite(Number(place.lon))
      ? `${Number(place.lat).toFixed(4)}, ${Number(place.lon).toFixed(4)}`
      : null

  return (
    <section
      className={clsx(
        'place-brief-enter flex h-full min-h-0 w-full flex-col overflow-hidden border shadow-2xl backdrop-blur-xl sm:rounded-2xl',
        dark
          ? 'border-gray-700/80 bg-gray-950/95 text-gray-100'
          : 'border-slate-200 bg-white/95 text-slate-900',
        'rounded-t-2xl',
      )}
      role="dialog"
      aria-label={`Flood forecast for ${place.name}`}
    >
      {/* Top bar — close left like Windy */}
      <header
        className={clsx(
          'flex shrink-0 items-center gap-3 border-b px-3 py-2.5 sm:px-4',
          dark ? 'border-gray-800' : 'border-slate-100',
        )}
      >
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-600 text-white shadow-md transition hover:bg-red-500"
          aria-label="Close forecast"
          title="Close"
        >
          <IconX size={15} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <h2 className="truncate font-display text-base font-semibold tracking-tight sm:text-lg">
              {place.name}
            </h2>
            {overallRisk ? (
              <span
                className="rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                style={{
                  color: RISK_COLOR[tier],
                  borderColor: `${RISK_COLOR[tier]}66`,
                  backgroundColor: dark ? '#0f172a' : '#fff',
                }}
              >
                {RISK_LABEL[tier]}
              </span>
            ) : null}
            {place.from_geolocation ? (
              <span className={clsx('inline-flex items-center gap-1 text-[10px]', dark ? 'text-sky-400' : 'text-sky-700')}>
                <IconLocate size={10} /> Near you
              </span>
            ) : null}
          </div>
          <p className={clsx('truncate text-[11px]', dark ? 'text-gray-400' : 'text-slate-500')}>
            {place.display_name || 'Nigeria'}
            {coords ? ` · ${coords}` : ''}
          </p>
        </div>
        <GenerateReportButton
          theme={theme}
          variant="icon"
          loading={exporting}
          disabled={loading}
          onClick={handleGenerateReport}
          label="Generate report"
          subtitle={reportSubtitle}
        />
      </header>

      {/* Tab panels — each tab replaces the main body (Windy-style) */}
      <div className="min-h-0 flex-1 overflow-auto">
        {loading && sheetTab === 'basic' && (
          <div className={clsx('px-4 py-3 text-xs', dark ? 'text-gray-400' : 'text-slate-500')}>
            Loading forecast for this location…
          </div>
        )}

        {sheetTab === 'basic' && !loading && (
          <div className="flex min-h-full flex-col">
            <div className="overflow-x-auto">
              {urbanFlashZone ? (
                <div
                  className={clsx(
                    'mx-3 mt-3 rounded-lg border px-3 py-2 text-left text-xs sm:mx-4',
                    dark
                      ? 'border-fuchsia-800/70 bg-fuchsia-950/45 text-fuchsia-100'
                      : 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-950',
                  )}
                  role="status"
                >
                  <span className="font-semibold">Urban flash flood alert · {urbanFlashZone.risk_tier}</span>
                  <span className="ml-1 opacity-80">
                    This point is inside {urbanFlashZone.name || 'an active rainfall-driven zone'}.
                  </span>
                </div>
              ) : null}
              <table className="w-full min-w-[36rem] border-collapse text-center text-[11px] sm:text-xs">
                <thead>
                  <tr className={dark ? 'bg-gray-900/80' : 'bg-slate-50'}>
                    <th
                      className={clsx(
                        'sticky left-0 z-10 w-28 border-b px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider',
                        dark ? 'border-gray-800 bg-gray-900 text-gray-500' : 'border-slate-200 bg-slate-50 text-slate-500',
                      )}
                    >
                      Horizon
                    </th>
                    {horizonCols.map((h) => (
                      <th
                        key={h}
                        className={clsx(
                          'border-b px-2 py-2 font-semibold tabular-nums',
                          dark ? 'border-gray-800 text-gray-300' : 'border-slate-200 text-slate-700',
                        )}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td
                      className={clsx(
                        'sticky left-0 z-10 border-b px-3 py-2.5 text-left font-medium',
                        dark ? 'border-gray-800 bg-gray-950 text-gray-400' : 'border-slate-100 bg-white text-slate-500',
                      )}
                    >
                      {urbanFlashZone ? 'River gauge probability' : 'Flood probability'}
                    </td>
                    {horizonCols.map((h) => {
                      const v = horizons[h] || {}
                      const hTier = v.risk_tier || 'Normal'
                      const pct =
                        v.flood_prob != null && Number.isFinite(Number(v.flood_prob))
                          ? Math.round(Number(v.flood_prob) <= 1 ? Number(v.flood_prob) * 100 : Number(v.flood_prob))
                          : null
                      return (
                        <td
                          key={`p-${h}`}
                          className={clsx(
                            'border-b px-2 py-2.5 text-base font-bold tabular-nums',
                            dark ? 'border-gray-800' : 'border-slate-100',
                            cellBg(hTier, dark),
                          )}
                        >
                          {pct != null ? `${pct}%` : '—'}
                        </td>
                      )
                    })}
                  </tr>
                  <tr>
                    <td
                      className={clsx(
                        'sticky left-0 z-10 border-b px-3 py-2.5 text-left font-medium',
                        dark ? 'border-gray-800 bg-gray-950 text-gray-400' : 'border-slate-100 bg-white text-slate-500',
                      )}
                    >
                      Risk status
                    </td>
                    {horizonCols.map((h) => {
                      const v = horizons[h] || {}
                      const hTier = v.risk_tier || tier || 'Normal'
                      return (
                        <td
                          key={`r-${h}`}
                          className={clsx(
                            'border-b px-2 py-2.5 font-semibold',
                            dark ? 'border-gray-800' : 'border-slate-100',
                            cellBg(hTier, dark),
                          )}
                        >
                          {RISK_LABEL[hTier] || hTier}
                        </td>
                      )
                    })}
                  </tr>
                  <tr>
                    <td
                      className={clsx(
                        'sticky left-0 z-10 px-3 py-2.5 text-left font-medium',
                        dark ? 'bg-gray-950 text-gray-400' : 'bg-white text-slate-500',
                      )}
                    >
                      Outlook
                    </td>
                    <td
                      colSpan={horizonCols.length}
                      className={clsx(
                        'px-3 py-2.5 text-left text-[12px] leading-relaxed',
                        dark ? 'text-gray-200' : 'text-slate-700',
                      )}
                    >
                      {overallRisk
                        ? placeRiskMessage(tier, place.name)
                        : 'No monitored river gauges within range for a full outlook. Conditions can still change with heavy rain.'}
                      {overallRisk ? (
                        <span className={clsx('mt-1 block text-[10px] font-semibold uppercase tracking-wide', dark ? 'text-gray-500' : 'text-slate-400')}>
                          {actionHint(tier)}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div
              className={clsx(
                'mt-auto grid gap-2 border-t px-3 py-2.5 sm:grid-cols-3 sm:px-4',
                dark ? 'border-gray-800' : 'border-slate-100',
              )}
            >
              <button
                type="button"
                onClick={() => setSheetTab('places')}
                className={clsx(
                  'rounded-lg border px-3 py-2 text-left transition',
                  dark ? 'border-gray-800 bg-gray-900/50 hover:border-gray-600' : 'border-slate-200 bg-slate-50 hover:border-slate-300',
                )}
              >
                <p className={clsx('text-[9px] uppercase tracking-wider', dark ? 'text-gray-500' : 'text-slate-500')}>Towns nearby</p>
                <p className="text-sm font-semibold tabular-nums">{settlementsLoading ? '…' : placesCount}</p>
              </button>
              <button
                type="button"
                onClick={() => setSheetTab('roads')}
                className={clsx(
                  'rounded-lg border px-3 py-2 text-left transition',
                  dark ? 'border-gray-800 bg-gray-900/50 hover:border-gray-600' : 'border-slate-200 bg-slate-50 hover:border-slate-300',
                )}
              >
                <p className={clsx('text-[9px] uppercase tracking-wider', dark ? 'text-gray-500' : 'text-slate-500')}>Roads at risk</p>
                <p className="text-sm font-semibold tabular-nums">{roadsLoading ? '…' : roadsAtRisk}</p>
              </button>
              <button
                type="button"
                onClick={() => setSheetTab('buildings')}
                className={clsx(
                  'rounded-lg border px-3 py-2 text-left transition',
                  dark ? 'border-gray-800 bg-gray-900/50 hover:border-gray-600' : 'border-slate-200 bg-slate-50 hover:border-slate-300',
                )}
              >
                <p className={clsx('text-[9px] uppercase tracking-wider', dark ? 'text-gray-500' : 'text-slate-500')}>Buildings exposed</p>
                <p className="text-sm font-semibold tabular-nums">{buildingsLoading ? '…' : buildingsExposed}</p>
              </button>
            </div>
          </div>
        )}

        {sheetTab === 'places' && (
          <div className="px-3 py-3 sm:px-4">
            <div className="mb-2 flex items-end justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold">Nearby places</h3>
                <p className={clsx('text-[11px]', dark ? 'text-gray-400' : 'text-slate-500')}>
                  {settlementsLoading
                    ? 'Loading neighbouring settlements…'
                    : localSettlementSummary
                      ? `${highlySusceptible || highlyLikely} of ${localSettlementSummary.total} in higher susceptibility · showing ${placesCount}`
                      : `${placesCount} places near this location`}
                </p>
              </div>
            </div>
            {!settlementsLoading && placesCount === 0 ? (
              <p className={clsx('py-6 text-center text-xs', dark ? 'text-gray-500' : 'text-slate-400')}>
                No neighbouring towns or villages found nearby.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border" style={{ borderColor: dark ? '#1f2937' : '#e2e8f0' }}>
                <table className="w-full min-w-[28rem] border-collapse text-left text-[11px] sm:text-xs">
                  <thead>
                    <tr className={dark ? 'bg-gray-900' : 'bg-slate-50'}>
                      {['Place', 'Class', 'Susceptibility', 'Outlook', 'Distance'].map((label) => (
                        <th
                          key={label}
                          className={clsx(
                            'border-b px-3 py-2 text-[10px] font-semibold uppercase tracking-wider',
                            dark ? 'border-gray-800 text-gray-500' : 'border-slate-200 text-slate-500',
                          )}
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {nearbySettlements.slice(0, 20).map((s) => (
                      <tr
                        key={`${s.name}-${s.lat}-${s.lon}`}
                        className={dark ? 'hover:bg-gray-900/80' : 'hover:bg-slate-50'}
                      >
                        <td className={clsx('border-b px-3 py-2', dark ? 'border-gray-800' : 'border-slate-100')}>
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
                            className="font-semibold text-sky-600 hover:underline dark:text-sky-400"
                          >
                            {s.name}
                          </button>
                        </td>
                        <td className={clsx('border-b px-3 py-2', dark ? 'border-gray-800 text-gray-400' : 'border-slate-100 text-slate-500')}>
                          {s.class || '—'}
                        </td>
                        <td
                          className={clsx('border-b px-3 py-2 font-semibold', dark ? 'border-gray-800' : 'border-slate-100')}
                          style={{ color: SUSCEPTIBILITY_TEXT_COLOR[s.susceptibility] || undefined }}
                        >
                          {s.susceptibility || '—'}
                        </td>
                        <td className={clsx('border-b px-3 py-2 font-semibold', dark ? 'border-gray-800' : 'border-slate-100')} style={{ color: RISK_COLOR[s.risk_tier] }}>
                          {RISK_LABEL[s.risk_tier] || s.risk_tier || '—'}
                        </td>
                        <td className={clsx('border-b px-3 py-2 tabular-nums', dark ? 'border-gray-800 text-gray-400' : 'border-slate-100 text-slate-500')}>
                          {formatDistance(s.distance_km)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {sheetTab === 'roads' && (
          <div className="px-3 py-3 sm:px-4">
            <div className="mb-2">
              <h3 className="text-sm font-semibold">Roads at risk</h3>
              <p className={clsx('text-[11px]', dark ? 'text-gray-400' : 'text-slate-500')}>
                {roadsLoading
                  ? 'Loading nearby roads…'
                  : `${roadsAtRisk} elevated-risk roads · ${nearbyRoads.length} listed`}
              </p>
            </div>
            {!roadsLoading && nearbyRoads.length === 0 ? (
              <p className={clsx('py-6 text-center text-xs', dark ? 'text-gray-500' : 'text-slate-400')}>
                No moderate+ susceptibility roads nearby.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border" style={{ borderColor: dark ? '#1f2937' : '#e2e8f0' }}>
                <table className="w-full min-w-[28rem] border-collapse text-left text-[11px] sm:text-xs">
                  <thead>
                    <tr className={dark ? 'bg-gray-900' : 'bg-slate-50'}>
                      {['Road', 'Class', 'Susceptibility', 'Distance'].map((label) => (
                        <th
                          key={label}
                          className={clsx(
                            'border-b px-3 py-2 text-[10px] font-semibold uppercase tracking-wider',
                            dark ? 'border-gray-800 text-gray-500' : 'border-slate-200 text-slate-500',
                          )}
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {nearbyRoads.slice(0, 20).map((r) => {
                      const key = `${r.osm_id || r.name}-${r.lat}-${r.lon}`
                      const active =
                        selectedRoad &&
                        `${selectedRoad.osm_id || selectedRoad.name}-${selectedRoad.lat}-${selectedRoad.lon}` === key
                      return (
                        <tr
                          key={key}
                          className={clsx(
                            active
                              ? dark
                                ? 'bg-sky-950/40'
                                : 'bg-sky-50'
                              : dark
                                ? 'hover:bg-gray-900/80'
                                : 'hover:bg-slate-50',
                          )}
                        >
                          <td className={clsx('border-b px-3 py-2', dark ? 'border-gray-800' : 'border-slate-100')}>
                            <button
                              type="button"
                              onClick={() => onSelectRoad?.(r)}
                              className="font-semibold text-sky-600 hover:underline dark:text-sky-400"
                            >
                              {r.name || r.ref || 'Unnamed road'}
                              {r.bridge ? ' · bridge' : ''}
                            </button>
                          </td>
                          <td className={clsx('border-b px-3 py-2', dark ? 'border-gray-800 text-gray-400' : 'border-slate-100 text-slate-500')}>
                            {r.class || '—'}
                          </td>
                          <td
                            className={clsx('border-b px-3 py-2 font-semibold', dark ? 'border-gray-800' : 'border-slate-100')}
                            style={{ color: SUSCEPTIBILITY_TEXT_COLOR[r.susceptibility] || undefined }}
                          >
                            {r.susceptibility || '—'}
                          </td>
                          <td className={clsx('border-b px-3 py-2 tabular-nums', dark ? 'border-gray-800 text-gray-400' : 'border-slate-100 text-slate-500')}>
                            {formatDistance(r.distance_km)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {sheetTab === 'buildings' && (
          <div className="px-3 py-3 sm:px-4">
            <div className="mb-2">
              <h3 className="text-sm font-semibold">Buildings</h3>
              <p className={clsx('text-[11px]', dark ? 'text-gray-400' : 'text-slate-500')}>
                {buildingsLoading
                  ? 'Loading buildings…'
                  : buildingsError
                    ? 'Could not load buildings for this view.'
                    : `${buildingsExposed} exposed in mapped flood zones · ${buildingSummary?.total_in_radius ?? nearbyBuildings.length} in scope`}
              </p>
            </div>
            {!buildingsLoading && !buildingsError && nearbyBuildings.length === 0 ? (
              <p className={clsx('py-6 text-center text-xs', dark ? 'text-gray-500' : 'text-slate-400')}>
                No buildings listed for this location yet. Zoom in on the map for denser coverage.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border" style={{ borderColor: dark ? '#1f2937' : '#e2e8f0' }}>
                <table className="w-full min-w-[24rem] border-collapse text-left text-[11px] sm:text-xs">
                  <thead>
                    <tr className={dark ? 'bg-gray-900' : 'bg-slate-50'}>
                      {['Building', 'Class', 'Distance'].map((label) => (
                        <th
                          key={label}
                          className={clsx(
                            'border-b px-3 py-2 text-[10px] font-semibold uppercase tracking-wider',
                            dark ? 'border-gray-800 text-gray-500' : 'border-slate-200 text-slate-500',
                          )}
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {nearbyBuildings.slice(0, 20).map((b, i) => (
                      <tr key={b.osm_id || i} className={dark ? 'hover:bg-gray-900/80' : 'hover:bg-slate-50'}>
                        <td className={clsx('border-b px-3 py-2 font-medium', dark ? 'border-gray-800' : 'border-slate-100')}>
                          {b.name || b.class || 'Building'}
                        </td>
                        <td className={clsx('border-b px-3 py-2', dark ? 'border-gray-800 text-gray-400' : 'border-slate-100 text-slate-500')}>
                          {b.class || '—'}
                        </td>
                        <td className={clsx('border-b px-3 py-2 tabular-nums', dark ? 'border-gray-800 text-gray-400' : 'border-slate-100 text-slate-500')}>
                          {b.distance_km != null ? formatDistance(b.distance_km) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {sheetTab === 'gauges' && (
          <div className="px-3 py-3 sm:px-4">
            <div className="mb-2">
              <h3 className="text-sm font-semibold">Monitoring stations</h3>
              <p className={clsx('text-[11px]', dark ? 'text-gray-400' : 'text-slate-500')}>
                {(nearby || []).length
                  ? `${nearby.length} gauges within monitoring range`
                  : 'No gauges within monitoring range'}
              </p>
            </div>
            {!(nearby || []).length ? (
              <p className={clsx('py-6 text-center text-xs', dark ? 'text-gray-500' : 'text-slate-400')}>
                No monitored river gauges near this point.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-xl border" style={{ borderColor: dark ? '#1f2937' : '#e2e8f0' }}>
                <table className="w-full min-w-[28rem] border-collapse text-left text-[11px] sm:text-xs">
                  <thead>
                    <tr className={dark ? 'bg-gray-900' : 'bg-slate-50'}>
                      {['Station', 'River', 'Outlook', 'Distance'].map((label) => (
                        <th
                          key={label}
                          className={clsx(
                            'border-b px-3 py-2 text-[10px] font-semibold uppercase tracking-wider',
                            dark ? 'border-gray-800 text-gray-500' : 'border-slate-200 text-slate-500',
                          )}
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(nearby || []).slice(0, 12).map((s) => (
                      <tr key={s.id} className={dark ? 'hover:bg-gray-900/80' : 'hover:bg-slate-50'}>
                        <td className={clsx('border-b px-3 py-2', dark ? 'border-gray-800' : 'border-slate-100')}>
                          <button
                            type="button"
                            onClick={() => onSelectStation?.(s.id)}
                            className="font-semibold text-sky-600 hover:underline dark:text-sky-400"
                          >
                            {s.name}
                          </button>
                        </td>
                        <td className={clsx('border-b px-3 py-2', dark ? 'border-gray-800 text-gray-400' : 'border-slate-100 text-slate-500')}>
                          {s.river || '—'}
                        </td>
                        <td
                          className={clsx('border-b px-3 py-2 font-semibold', dark ? 'border-gray-800' : 'border-slate-100')}
                          style={{ color: RISK_COLOR[s.overall_risk] }}
                        >
                          {RISK_LABEL[s.overall_risk] || s.overall_risk || '—'}
                        </td>
                        <td className={clsx('border-b px-3 py-2 tabular-nums', dark ? 'border-gray-800 text-gray-400' : 'border-slate-100 text-slate-500')}>
                          {formatDistance(s.distance_km)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom tabs — like Windy */}
      <nav
        className={clsx(
          'flex shrink-0 gap-0.5 overflow-x-auto border-t px-2 py-1.5',
          dark ? 'border-gray-800 bg-gray-900/90' : 'border-slate-200 bg-slate-50/90',
        )}
        role="tablist"
        aria-label="Forecast sections"
      >
        {SHEET_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={sheetTab === tab.id}
            onClick={() => setSheetTab(tab.id)}
            className={clsx(
              'shrink-0 rounded-lg px-3 py-2 text-[11px] font-semibold transition',
              sheetTab === tab.id
                ? 'bg-sky-600 text-white'
                : dark
                  ? 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                  : 'text-slate-500 hover:bg-white hover:text-slate-800',
            )}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </section>
  )
}
