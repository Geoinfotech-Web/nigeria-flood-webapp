import React, { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import MapPanel from './components/MapPanel'
import StationList from './components/StationList'
import ExpertOverviewPanel from './components/ExpertOverviewPanel'
import ExpertKpiStrip from './components/ExpertKpiStrip'
import ExpertAnalyticsRow from './components/ExpertAnalyticsRow'
import StationConsole from './components/StationConsole'
import PublicHeader from './components/PublicHeader'
import PlaceBriefPanel from './components/PlaceBriefPanel'
import PublicGaugePanel from './components/PublicGaugePanel'
import NationalAlertsStrip from './components/NationalAlertsStrip'
import DisclaimerBar from './components/DisclaimerBar'
import FloodIncidentReporter from './components/FloodIncidentReporter'
import FloodSafeRouting from './components/FloodSafeRouting'
import { IconGauge, IconX } from './components/Icons'
import { useGaugeFeed } from './hooks/useGaugeFeed'
import { useStations } from './hooks/useStations'
import { useAllPredictions } from './hooks/useAllPredictions'
import { useImpactSummary } from './hooks/useImpactSummary'
import { useUrbanFlashSummary } from './hooks/useUrbanFlashSummary'
import { useNationalRainfall } from './hooks/useNationalRainfall'
import { usePlaceConditions } from './hooks/usePlaceConditions'
import { useNearbySettlements } from './hooks/useNearbySettlements'
import { useNearbyRoads } from './hooks/useNearbyRoads'
import { useNearbyBuildings } from './hooks/useNearbyBuildings'
import { useDetectLocation } from './hooks/useDetectLocation'
import { useAffectedSettlementsSummary } from './hooks/useAffectedSettlementsSummary'
import AffectedPlacesStat from './components/AffectedPlacesStat'
import RouteConditionsPanel from './components/RouteConditionsPanel'

function readPlaceFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search)
    const lat = parseFloat(params.get('lat'))
    const lon = parseFloat(params.get('lon'))
    const name = params.get('name')
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !name) return null
    return {
      name,
      display_name: params.get('display') || name,
      lat,
      lon,
      bbox_lnglat: null,
    }
  } catch {
    return null
  }
}

function writePlaceToUrl(place) {
  const url = new URL(window.location.href)
  if (!place) {
    ;['lat', 'lon', 'name', 'display'].forEach((k) => url.searchParams.delete(k))
  } else {
    url.searchParams.set('lat', String(place.lat))
    url.searchParams.set('lon', String(place.lon))
    url.searchParams.set('name', place.name)
    if (place.display_name) url.searchParams.set('display', place.display_name)
  }
  window.history.replaceState({}, '', url)
}

export default function App() {
  const { stations } = useStations()
  const liveReadings = useGaugeFeed()
  const [theme, setTheme] = useState('light')
  const [basemap, setBasemap] = useState('streets')
  const [mode, setMode] = useState('public')
  const [selected, setSelected] = useState(null)
  const [showSelectedBasin, setShowSelectedBasin] = useState(false)
  const [place, setPlace] = useState(() => readPlaceFromUrl())
  const [highlightedRoad, setHighlightedRoad] = useState(null)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportInitialTab, setReportInitialTab] = useState(null)
  const [navigation, setNavigation] = useState(null)
  const [buildingsTabActive, setBuildingsTabActive] = useState(false)
  const [viewportBuildings, setViewportBuildings] = useState(null)
  const [expertListOpen, setExpertListOpen] = useState(false)
  const [analyticsCollapsed, setAnalyticsCollapsed] = useState(false)

  const handleBuildingsViewportChange = useCallback((payload) => {
    setViewportBuildings(payload)
  }, [])

  const {
    byStation: predictionsByStation,
    updatedAt: predictionsUpdatedAt,
    loading: predictionsLoading,
  } = useAllPredictions(mode === 'expert')

  const { summary: impactSummary } = useImpactSummary({ enabled: mode === 'expert' })
  const { summary: urbanFlashSummary } = useUrbanFlashSummary({ enabled: mode === 'expert' })
  const { latestAvgMm } = useNationalRainfall({
    enabled: mode === 'expert',
    days: 7,
  })

  const openReportFeed = useCallback(() => {
    setReportInitialTab('feed')
    setReportOpen(true)
  }, [])

  const handleReportOpenChange = useCallback((open) => {
    setReportOpen(open)
    if (!open) setReportInitialTab(null)
  }, [])

  const sortedStations = useMemo(
    () => [...stations].sort((a, b) => a.name.localeCompare(b.name)),
    [stations],
  )
  const selectedStation = sortedStations.find((s) => s.id === selected)

  const handlePlaceSelect = useCallback((result) => {
    setHighlightedRoad(null)
    setBuildingsTabActive(false)
    setViewportBuildings(null)
    setPlace(result)
    setSelected(null)
  }, [])

  const placeConditions = usePlaceConditions(place, sortedStations)
  const { settlements, localSummary, loading: settlementsLoading } = useNearbySettlements(
    place,
    placeConditions.nearby,
  )
  const { roads: nearbyRoads, summary: roadSummary, loading: roadsLoading } = useNearbyRoads(place)
  const {
    buildings: placeBuildings,
    summary: placeBuildingSummary,
    loading: placeBuildingsLoading,
    error: placeBuildingsError,
  } = useNearbyBuildings(place)

  // Prefer map-viewport buildings (updates on pan/zoom); fall back to place-radius query
  const useViewport =
    buildingsTabActive &&
    viewportBuildings &&
    (viewportBuildings.status === 'ready' ||
      viewportBuildings.status === 'loading' ||
      viewportBuildings.status === 'zoom')

  const nearbyBuildings = useViewport
    ? viewportBuildings.buildings || []
    : placeBuildings
  const buildingSummary = useViewport
    ? viewportBuildings.summary ||
      (viewportBuildings.status === 'zoom'
        ? {
            total_in_radius: 0,
            exposed_in_flood_zones: 0,
            note: 'Zoom in closer on the map to load buildings for this view.',
            scope: 'map_viewport',
          }
        : null)
    : placeBuildingSummary
  const buildingsLoading = useViewport
    ? viewportBuildings.status === 'loading'
    : placeBuildingsLoading
  const buildingsError =
    useViewport && viewportBuildings.status === 'error'
      ? viewportBuildings.error || new Error('Buildings failed to load')
      : useViewport
        ? null
        : placeBuildingsError
  const { detect, locating, error: locationError } = useDetectLocation(handlePlaceSelect)
  const {
    summary: nationalAffectedSummary,
    loading: affectedLoading,
  } = useAffectedSettlementsSummary({ minTier: 'Warning', radiusKm: 25 })

  const stripSummary = place ? localSummary : nationalAffectedSummary
  const stripLoading = place ? settlementsLoading : affectedLoading
  const stripScope = place ? 'local' : 'nationwide'

  // Auto-detect location once on public mode if no place is set (URL/share)
  useEffect(() => {
    if (mode !== 'public' || place) return
    try {
      if (sessionStorage.getItem('flood_watch_geo_prompted') === '1') return
      sessionStorage.setItem('flood_watch_geo_prompted', '1')
    } catch {
      /* ignore */
    }
    detect()
  }, [mode, place, detect])

  useEffect(() => {
    writePlaceToUrl(place)
  }, [place])

  useEffect(() => {
    if (mode === 'public') {
      setBasemap((b) => (b === 'dark' ? 'streets' : b))
    }
  }, [mode])

  const clearSelectedStation = () => {
    setSelected(null)
    setShowSelectedBasin(false)
  }
  const handleSelectStation = (stationId) => {
    setSelected((current) => {
      if (current === stationId) {
        setShowSelectedBasin(false)
        return null
      }
      setShowSelectedBasin(false)
      return stationId
    })
  }

  const clearPlace = () => {
    setPlace(null)
    setSelected(null)
    setShowSelectedBasin(false)
    setHighlightedRoad(null)
    setBuildingsTabActive(false)
    setViewportBuildings(null)
  }

  const handleAlertStation = (stationName) => {
    const match = sortedStations.find((s) => s.name === stationName)
    if (match) {
      setShowSelectedBasin(false)
      setSelected(match.id)
      setPlace({
        name: match.name,
        display_name: `${match.river}, ${match.state}, Nigeria`,
        lat: match.lat,
        lon: match.lon,
        bbox_lnglat: null,
      })
    }
  }

  const publicShell =
    theme === 'dark' ? 'bg-gray-950 text-gray-100' : 'bg-slate-100 text-slate-900'

  return (
    <div className={clsx('flex h-[100dvh] flex-col transition-colors', publicShell)}>
      <PublicHeader
        theme={theme}
        onThemeChange={setTheme}
        onPlaceSelect={handlePlaceSelect}
        mode={mode}
        onModeChange={setMode}
        stationCount={stations.length}
        onDetectLocation={detect}
        locating={locating}
        locationError={locationError}
      />

      <NationalAlertsStrip
        theme={theme}
        onSelectStation={handleAlertStation}
        onSelectPlace={handlePlaceSelect}
        affectedSummary={stripSummary}
        affectedLoading={stripLoading}
        affectedScope={stripScope}
        placeName={place?.name}
        onReportFlood={() => {
          setReportInitialTab('report')
          setReportOpen(true)
        }}
        routingControl={<FloodSafeRouting theme={theme} onNavigationChange={setNavigation} inline expert={mode === 'expert'} />}
      />

      <FloodIncidentReporter
        theme={theme}
        open={reportOpen}
        onOpenChange={handleReportOpenChange}
        showTrigger={false}
        initialTab={reportInitialTab}
      />

      {mode === 'public' ? (
        <div className="relative flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Place brief — bottom sheet on mobile, side panel on desktop */}
          <aside
            className={clsx(
              'z-20 order-2 w-full shrink-0 md:order-1 md:w-[22rem] lg:w-[24rem]',
              navigation || place || selectedStation
                ? 'max-h-[48vh] md:max-h-none md:h-full'
                : 'hidden md:flex md:max-h-none md:h-full',
            )}
          >
            {navigation ? (
              <div className="h-full p-0 md:p-3 md:pr-0">
                <RouteConditionsPanel
                  navigation={navigation}
                  stations={sortedStations}
                  liveReadings={liveReadings}
                  theme={theme}
                  onClose={() => setNavigation(null)}
                />
              </div>
            ) : selectedStation ? (
              <div className="h-full p-0 md:p-3 md:pr-0">
                <PublicGaugePanel
                  station={selectedStation}
                  stationId={selected}
                  liveReading={liveReadings[selected]}
                  theme={theme}
                  basinVisible={showSelectedBasin}
                  onToggleBasin={setShowSelectedBasin}
                  onClose={clearSelectedStation}
                />
              </div>
            ) : place ? (
              <div className="h-full p-0 md:p-3 md:pr-0">
                <PlaceBriefPanel
                  place={place}
                  overallRisk={placeConditions.overallRisk}
                  primaryStation={placeConditions.primaryStation}
                  nearby={placeConditions.nearby}
                  nearbySettlements={settlements}
                  localSettlementSummary={localSummary}
                  settlementsLoading={settlementsLoading}
                  nearbyRoads={nearbyRoads}
                  roadSummary={roadSummary}
                  roadsLoading={roadsLoading}
                  selectedRoad={highlightedRoad}
                  onSelectRoad={setHighlightedRoad}
                  nearbyBuildings={nearbyBuildings}
                  buildingSummary={buildingSummary}
                  buildingsLoading={buildingsLoading}
                  buildingsError={buildingsError}
                  loading={placeConditions.loading}
                  liveReadings={liveReadings}
                  theme={theme}
                  onClose={clearPlace}
                  onSelectStation={handleSelectStation}
                  onSelectPlace={handlePlaceSelect}
                  onPanelTabChange={(tab) => setBuildingsTabActive(tab === 'buildings')}
                />
              </div>
            ) : (
              <div
                className={clsx(
                  'm-3 mr-0 hidden h-[calc(100%-1.5rem)] flex-col justify-between rounded-2xl border p-5 md:flex',
                  theme === 'dark'
                    ? 'border-gray-800 bg-gray-900/70'
                    : 'border-slate-200 bg-white/80',
                )}
              >
                <div>
                  <p
                    className={clsx(
                      'text-[10px] font-semibold uppercase tracking-[0.16em]',
                      theme === 'dark' ? 'text-sky-400/80' : 'text-sky-700',
                    )}
                  >
                    Early warning
                  </p>
                  <h2 className="font-display mt-2 text-2xl font-semibold tracking-tight leading-snug">
                    Check flood risk for any place in Nigeria
                  </h2>
                  <p
                    className={clsx(
                      'mt-3 text-sm leading-relaxed',
                      theme === 'dark' ? 'text-gray-400' : 'text-slate-600',
                    )}
                  >
                    Search a city or town to see the nearest river-gauge forecast for the next
                    72 hours, nearby towns at flood susceptibility risk, major roads at risk,
                    and buildings inside flood zones. Use separate toggles for Inundation
                    probability, Inundation history, and Flood Susceptibility.
                  </p>
                  <div className="mt-4">
                    <AffectedPlacesStat
                      summary={
                        place
                          ? localSummary
                          : nationalAffectedSummary
                      }
                      loading={place ? settlementsLoading : affectedLoading}
                      theme={theme}
                      scope={place ? 'local' : 'nationwide'}
                      placeName={place?.name}
                      onSelectPlace={handlePlaceSelect}
                    />
                  </div>
                </div>
                <ul
                  className={clsx(
                    'mt-6 space-y-2 text-xs',
                    theme === 'dark' ? 'text-gray-400' : 'text-slate-500',
                  )}
                >
                  <li>Allow location, or search a city like Lokoja</li>
                  <li>Open the highly-likely list and tap a place</li>
                  <li>Tap an active alert chip above to jump there</li>
                  <li>Switch to Expert for the full station console</li>
                </ul>
              </div>
            )}
          </aside>

          <main className="relative order-1 min-h-0 flex-1 md:order-2">
            {!place && (
              <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex justify-center px-4 md:hidden">
                <p
                  className={clsx(
                    'rounded-full border px-3 py-1.5 text-[11px] font-medium shadow-lg backdrop-blur',
                    theme === 'dark'
                      ? 'border-gray-700 bg-gray-900/85 text-gray-200'
                      : 'border-white/80 bg-white/90 text-slate-700',
                  )}
                >
                  Search above or use the location button
                </p>
              </div>
            )}
            <MapPanel
              stations={sortedStations}
              liveReadings={liveReadings}
              selected={selected}
              onSelect={handleSelectStation}
              basemap={basemap}
              onBasemapChange={setBasemap}
              theme={theme}
              variant="public"
              placeFocus={place}
              roadHighlight={highlightedRoad}
              forceBuildingsLayer={buildingsTabActive}
              onBuildingsViewportChange={handleBuildingsViewportChange}
              showSearch={false}
              navigation={navigation}
              highlightSelectedBasin={showSelectedBasin}
            />
          </main>
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <ExpertKpiStrip
            impactSummary={impactSummary}
            urbanFlashSummary={urbanFlashSummary}
            rainfallAvgMm={latestAvgMm}
            theme={theme}
          />

          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            {/* Desktop triage rail */}
            <aside
              className={clsx(
                'hidden w-56 shrink-0 overflow-hidden border-r lg:w-64 sm:flex sm:flex-col',
                theme === 'dark' ? 'border-gray-800 bg-gray-900/60' : 'border-slate-200 bg-white/90',
              )}
            >
              <StationList
                stations={sortedStations}
                liveReadings={liveReadings}
                predictionsByStation={predictionsByStation}
                selected={selected}
                onSelect={handleSelectStation}
                onReset={clearSelectedStation}
                theme={theme}
              />
            </aside>

            {/* Mobile gauges drawer */}
            {expertListOpen && (
              <div className="absolute inset-0 z-40 flex sm:hidden">
                <button
                  type="button"
                  className="absolute inset-0 bg-black/40"
                  aria-label="Close gauge list"
                  onClick={() => setExpertListOpen(false)}
                />
                <aside
                  className={clsx(
                    'relative z-10 flex h-full w-[min(20rem,88vw)] flex-col shadow-2xl',
                    theme === 'dark' ? 'bg-gray-900' : 'bg-white',
                  )}
                >
                  <div
                    className={clsx(
                      'flex items-center justify-between border-b px-3 py-2',
                      theme === 'dark' ? 'border-gray-800' : 'border-slate-200',
                    )}
                  >
                    <p
                      className={clsx(
                        'text-[11px] font-semibold uppercase tracking-wide',
                        theme === 'dark' ? 'text-gray-300' : 'text-slate-700',
                      )}
                    >
                      Gauges
                    </p>
                    <button
                      type="button"
                      onClick={() => setExpertListOpen(false)}
                      className={clsx(
                        'inline-flex h-8 w-8 items-center justify-center rounded-lg border',
                        theme === 'dark'
                          ? 'border-gray-700 text-gray-300'
                          : 'border-slate-200 text-slate-600',
                      )}
                      aria-label="Close"
                    >
                      <IconX size={14} />
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-hidden">
                    <StationList
                      stations={sortedStations}
                      liveReadings={liveReadings}
                      predictionsByStation={predictionsByStation}
                      selected={selected}
                      onSelect={(id) => {
                        handleSelectStation(id)
                        setExpertListOpen(false)
                      }}
                      onReset={clearSelectedStation}
                      theme={theme}
                    />
                  </div>
                </aside>
              </div>
            )}

            <main className="relative min-h-0 flex-1">
              <button
                type="button"
                onClick={() => setExpertListOpen(true)}
                className={clsx(
                  'absolute left-3 top-3 z-20 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold shadow-md sm:hidden',
                  theme === 'dark'
                    ? 'border-gray-700 bg-gray-900/95 text-gray-100'
                    : 'border-slate-200 bg-white/95 text-slate-800',
                )}
              >
                <IconGauge size={13} />
                Gauges
              </button>
              <MapPanel
                stations={sortedStations}
                liveReadings={liveReadings}
                selected={selected}
                onSelect={handleSelectStation}
                basemap={basemap}
                onBasemapChange={setBasemap}
                theme={theme}
                variant="expert"
                placeFocus={place}
                onPlaceSelect={handlePlaceSelect}
                showSearch={false}
                navigation={navigation}
                highlightSelectedBasin={Boolean(selected)}
              />
            </main>

            <aside
              className={clsx(
                'absolute inset-x-0 bottom-0 z-30 max-h-[55vh] overflow-hidden border-t md:static md:inset-auto md:z-auto md:flex md:max-h-none md:w-[22rem] md:shrink-0 md:flex-col md:border-l md:border-t-0 lg:w-[24rem]',
                theme === 'dark'
                  ? 'border-gray-800 bg-gray-900/95'
                  : 'border-slate-200 bg-white/95',
              )}
            >
              {selectedStation ? (
                <StationConsole
                  station={selectedStation}
                  stationId={selected}
                  liveReading={liveReadings[selected]}
                  theme={theme}
                  onClose={clearSelectedStation}
                />
              ) : (
                <ExpertOverviewPanel
                  stations={sortedStations}
                  liveReadings={liveReadings}
                  predictionsByStation={predictionsByStation}
                  predictionsUpdatedAt={predictionsUpdatedAt}
                  predictionsLoading={predictionsLoading}
                  onSelectStation={handleSelectStation}
                  theme={theme}
                />
              )}
            </aside>
          </div>

          <ExpertAnalyticsRow
            stations={sortedStations}
            liveReadings={liveReadings}
            impactSummary={impactSummary}
            urbanFlashSummary={urbanFlashSummary}
            theme={theme}
            onSelectStation={handleSelectStation}
            onViewReports={openReportFeed}
            collapsed={analyticsCollapsed}
            onToggleCollapsed={() => setAnalyticsCollapsed((v) => !v)}
          />
        </div>
      )}

      <DisclaimerBar theme={theme} />
    </div>
  )
}
