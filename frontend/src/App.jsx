import React, { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import MapPanel from './components/MapPanel'
import ExpertOverviewPanel from './components/ExpertOverviewPanel'
import ExpertKpiStrip from './components/ExpertKpiStrip'
import ExpertAnalyticsRow from './components/ExpertAnalyticsRow'
import StationConsole from './components/StationConsole'
import AtRiskPlacesPanel from './components/AtRiskPlacesPanel'
import DevelopersPage from './components/DevelopersPage'
import PublicHeader from './components/PublicHeader'
import PlaceBriefPanel from './components/PlaceBriefPanel'
import ExpertIntelligenceReport from './components/ExpertIntelligenceReport'
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
import { useStationRainfall } from './hooks/useStationRainfall'
import { usePlaceConditions } from './hooks/usePlaceConditions'
import { useNearbySettlements } from './hooks/useNearbySettlements'
import { useNearbyRoads } from './hooks/useNearbyRoads'
import { useNearbyBuildings } from './hooks/useNearbyBuildings'
import { useDetectLocation } from './hooks/useDetectLocation'
import { useTerrain } from './hooks/useTerrain'
import { useSiteAssessment } from './hooks/useSiteAssessment'
import { useAffectedSettlements } from './hooks/useAffectedSettlements'
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

function readApiPreviewFromUrl() {
  try {
    return new URLSearchParams(window.location.search).get('api_preview') === '1'
  } catch {
    return false
  }
}

export default function App() {
  const { stations } = useStations()
  const liveReadings = useGaugeFeed()
  const [theme, setTheme] = useState('light')
  const [basemap, setBasemap] = useState('streets')
  const [mode, setMode] = useState(() => (readApiPreviewFromUrl() ? 'developers' : 'public'))
  const apiPreview = readApiPreviewFromUrl()
  const [selected, setSelected] = useState(null)
  const [showSelectedBasin, setShowSelectedBasin] = useState(false)
  const [place, setPlace] = useState(() => readPlaceFromUrl())
  const [zoneFocus, setZoneFocus] = useState(null)
  const [communityReportFocus, setCommunityReportFocus] = useState(null)
  const [highlightedRoad, setHighlightedRoad] = useState(null)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportInitialTab, setReportInitialTab] = useState(null)
  const [navigation, setNavigation] = useState(null)
  const [buildingsTabActive, setBuildingsTabActive] = useState(false)
  const [viewportBuildings, setViewportBuildings] = useState(null)
  const [expertListOpen, setExpertListOpen] = useState(false)
  const [expertMobileConsoleOpen, setExpertMobileConsoleOpen] = useState(false)
  const [analyticsCollapsed, setAnalyticsCollapsed] = useState(false)
  const [expertPlaceFilters, setExpertPlaceFilters] = useState({
    query: '',
    state: 'All',
    placeClass: 'All',
    riskTier: 'All',
  })

  const handleBuildingsViewportChange = useCallback((payload) => {
    setViewportBuildings(payload)
  }, [])

  const {
    byStation: predictionsByStation,
    updatedAt: predictionsUpdatedAt,
    loading: predictionsLoading,
  } = useAllPredictions(mode === 'expert')

  const sortedStations = useMemo(
    () => [...stations].sort((a, b) => a.name.localeCompare(b.name)),
    [stations],
  )
  const selectedStation = sortedStations.find((s) => s.id === selected)

  const placeConditions = usePlaceConditions(place, sortedStations)
  const primaryStationId =
    mode === 'expert' && place && placeConditions.primaryStation?.id
      ? placeConditions.primaryStation.id
      : null

  // National impact for analytics row; station-scoped impact when a place is selected (KPI strip).
  const { summary: nationalImpactSummary, loading: nationalImpactLoading } = useImpactSummary({
    enabled: mode === 'expert',
  })
  const { summary: scopedImpactSummary, loading: scopedImpactLoading } = useImpactSummary({
    enabled: mode === 'expert' && Boolean(primaryStationId),
    stationId: primaryStationId,
  })

  const { summary: nationalUrbanFlashSummary, loading: urbanFlashLoading } = useUrbanFlashSummary({
    enabled: mode === 'expert',
  })
  const { latestAvgMm } = useNationalRainfall({
    enabled: mode === 'expert',
    days: 7,
  })
  const { totalMm: placeRainMm } = useStationRainfall({
    enabled: mode === 'expert' && Boolean(place),
    stationId: primaryStationId,
    days: 1,
  })
  const {
    summary: affectedSettlements,
    loading: affectedSettlementsLoading,
  } = useAffectedSettlements({
    enabled: mode === 'expert',
    minTier: 'Warning',
    radiusKm: 25,
    state: expertPlaceFilters.state,
    placeClass: expertPlaceFilters.placeClass,
    riskTier: expertPlaceFilters.riskTier,
    query: expertPlaceFilters.query,
    limit: 160,
  })

  const openReportFeed = useCallback(() => {
    setReportInitialTab('feed')
    setReportOpen(true)
  }, [])

  const focusCommunityReport = useCallback((report) => {
    if (!report) return openReportFeed()
    setCommunityReportFocus({ ...report, focusKey: Date.now() })
  }, [openReportFeed])

  const handleReportOpenChange = useCallback((open) => {
    setReportOpen(open)
    if (!open) setReportInitialTab(null)
  }, [])

  const handlePlaceSelect = useCallback((result) => {
    setZoneFocus(null)
    setHighlightedRoad(null)
    setBuildingsTabActive(false)
    setViewportBuildings(null)
    // Stamp focusAt so re-selecting the same place still re-triggers map zoom
    setPlace({ ...result, focusAt: Date.now() })
    setSelected(null)
    setShowSelectedBasin(false)
    setExpertMobileConsoleOpen(true)
  }, [])

  const selectAtRiskPlace = useCallback(
    (nextPlace) => {
      handlePlaceSelect({
        name: nextPlace.name,
        display_name: nextPlace.display_name || `${nextPlace.name}, Nigeria`,
        lat: nextPlace.lat,
        lon: nextPlace.lon,
        bbox_lnglat: null,
        class: nextPlace.class || null,
        state: nextPlace.state || null,
        population: nextPlace.population ?? null,
        susceptibility: nextPlace.susceptibility || null,
        susceptibility_class: nextPlace.susceptibility_class ?? null,
        nearest_station: nextPlace.nearest_station || null,
        station_risk_tier: nextPlace.station_risk_tier || null,
        distance_km: nextPlace.distance_km ?? null,
      })
    },
    [handlePlaceSelect],
  )

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
  const { terrain, loading: terrainLoading } = useTerrain(mode === 'expert' ? place : null)
  const { assessment: siteAssessment, loading: siteLoading } = useSiteAssessment(
    mode === 'expert' ? place : null,
  )

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
    setZoneFocus(null)
    setPlace(null)
    setExpertMobileConsoleOpen(true)
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
    setZoneFocus(null)
    setSelected(null)
    setShowSelectedBasin(false)
    setHighlightedRoad(null)
    setBuildingsTabActive(false)
    setViewportBuildings(null)
    setExpertMobileConsoleOpen(false)
  }

  const resetExpertPlaceFilters = useCallback(() => {
    setExpertPlaceFilters({
      query: '',
      state: 'All',
      placeClass: 'All',
      riskTier: 'All',
    })
    setPlace(null)
    setZoneFocus(null)
  }, [])

  const handleAlertStation = (stationName) => {
    const match = sortedStations.find((s) => s.name === stationName)
    if (match) {
      setZoneFocus(null)
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

  const handleSelectUrbanFlash = useCallback((area) => {
    if (!area) return
    setSelected(null)
    setShowSelectedBasin(false)
    setPlace(null)
    setHighlightedRoad(null)
    setBuildingsTabActive(false)
    setViewportBuildings(null)
    setZoneFocus(area)
  }, [])

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
        showAffectedPlaces={mode === 'public'}
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

      {mode === 'developers' && apiPreview ? (
        <DevelopersPage theme={theme} preview />
      ) : mode === 'public' ? (
        <div className="relative flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Place brief — bottom sheet on mobile, side panel on desktop */}
          <aside
            className={clsx(
              'z-20 order-2 w-full shrink-0 md:order-1 md:flex md:w-[22rem] md:flex-col lg:w-[24rem]',
              navigation || place || selectedStation
                ? 'flex h-[min(48vh,26rem)] flex-col overflow-hidden rounded-t-2xl border-t md:h-full md:max-h-none md:overflow-hidden md:rounded-none md:border-t-0'
                : 'hidden md:h-full',
              (navigation || place || selectedStation) && (
                theme === 'dark' ? 'border-gray-800 bg-gray-950/95' : 'border-slate-200 bg-white'
              ),
            )}
          >
            {navigation ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-0 md:p-3 md:pr-0">
                <RouteConditionsPanel
                  navigation={navigation}
                  stations={sortedStations}
                  liveReadings={liveReadings}
                  theme={theme}
                  onClose={() => setNavigation(null)}
                />
              </div>
            ) : selectedStation ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-0 md:p-3 md:pr-0">
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
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-0 md:p-3 md:pr-0">
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
            place={place}
            placeConditions={placeConditions}
            localSettlementSummary={localSummary}
            settlementsLoading={settlementsLoading}
            roadSummary={roadSummary}
            roadsLoading={roadsLoading}
            siteAssessment={siteAssessment}
            impactSummary={place ? scopedImpactSummary : nationalImpactSummary}
            urbanFlashSummary={nationalUrbanFlashSummary}
            impactLoading={place ? scopedImpactLoading : nationalImpactLoading}
            urbanFlashLoading={urbanFlashLoading}
            rainfallAvgMm={latestAvgMm}
            placeRainMm={placeRainMm}
            theme={theme}
          />

          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            {/* Desktop places rail */}
            <aside
              className={clsx(
                'hidden w-56 shrink-0 overflow-hidden border-r lg:w-64 sm:flex sm:flex-col',
                theme === 'dark' ? 'border-gray-800 bg-gray-900/60' : 'border-slate-200 bg-white/90',
              )}
            >
              <AtRiskPlacesPanel
                summary={affectedSettlements}
                loading={affectedSettlementsLoading}
                selectedPlace={place}
                filters={expertPlaceFilters}
                onFiltersChange={(patch) =>
                  setExpertPlaceFilters((current) => ({ ...current, ...patch }))
                }
                onSelectPlace={selectAtRiskPlace}
                onReset={resetExpertPlaceFilters}
                theme={theme}
              />
            </aside>

            {/* Mobile places drawer */}
            {expertListOpen && (
              <div className="absolute inset-0 z-40 flex sm:hidden">
                <button
                  type="button"
                  className="absolute inset-0 bg-black/40"
                  aria-label="Close places list"
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
                      Places
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
                    <AtRiskPlacesPanel
                      summary={affectedSettlements}
                      loading={affectedSettlementsLoading}
                      selectedPlace={place}
                      filters={expertPlaceFilters}
                      onFiltersChange={(patch) =>
                        setExpertPlaceFilters((current) => ({ ...current, ...patch }))
                      }
                      onSelectPlace={(nextPlace) => {
                        selectAtRiskPlace(nextPlace)
                        setExpertListOpen(false)
                      }}
                      onReset={resetExpertPlaceFilters}
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
                  'absolute bottom-24 left-3 z-20 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[11px] font-semibold shadow-md sm:hidden',
                  theme === 'dark'
                    ? 'border-gray-700 bg-gray-900/95 text-gray-100'
                    : 'border-slate-200 bg-white/95 text-slate-800',
                )}
              >
                <IconGauge size={13} />
                Places
              </button>
              {!selectedStation && !place && !expertMobileConsoleOpen && (
                <button
                  type="button"
                  onClick={() => setExpertMobileConsoleOpen(true)}
                  className={clsx(
                    'absolute bottom-24 right-3 z-20 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-[11px] font-semibold shadow-md md:hidden',
                    theme === 'dark'
                      ? 'border-sky-700 bg-sky-950/95 text-sky-100'
                      : 'border-sky-200 bg-sky-50/95 text-sky-900',
                  )}
                >
                  Console
                </button>
              )}
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
                zoneFocus={zoneFocus}
                communityReportFocus={communityReportFocus}
                roadHighlight={highlightedRoad}
                onPlaceSelect={handlePlaceSelect}
                showSearch={false}
                navigation={navigation}
                highlightSelectedBasin={showSelectedBasin}
                bottomSheetOverlay={Boolean(
                  selectedStation || place || expertMobileConsoleOpen,
                )}
              />
            </main>

            <aside
              className={clsx(
                'z-30 flex flex-col overflow-hidden border-t md:static md:inset-auto md:z-auto md:max-h-none md:w-[22rem] md:shrink-0 md:border-l md:border-t-0 lg:w-[24rem]',
                selectedStation || place || expertMobileConsoleOpen
                  ? 'absolute inset-x-0 bottom-0 h-[min(55vh,28rem)] rounded-t-2xl md:relative md:bottom-auto md:h-full md:rounded-none'
                  : 'hidden md:flex md:h-full',
                theme === 'dark'
                  ? 'border-gray-800 bg-gray-900/95'
                  : 'border-slate-200 bg-white/95',
              )}
            >
              {(selectedStation || place || expertMobileConsoleOpen) && !selectedStation && !place && (
                <div
                  className={clsx(
                    'flex shrink-0 items-center justify-between border-b px-3 py-2 md:hidden',
                    theme === 'dark' ? 'border-gray-800' : 'border-slate-200',
                  )}
                >
                  <p className={clsx('text-[11px] font-semibold', theme === 'dark' ? 'text-gray-200' : 'text-slate-800')}>
                    Network overview
                  </p>
                  <button
                    type="button"
                    onClick={() => setExpertMobileConsoleOpen(false)}
                    className={clsx(
                      'rounded-md px-2 py-1 text-[10px] font-medium',
                      theme === 'dark' ? 'text-gray-400 hover:bg-gray-800' : 'text-slate-500 hover:bg-slate-100',
                    )}
                  >
                    Close
                  </button>
                </div>
              )}
              {selectedStation ? (
                <StationConsole
                  station={selectedStation}
                  stationId={selected}
                  liveReading={liveReadings[selected]}
                  theme={theme}
                  basinVisible={showSelectedBasin}
                  onToggleBasin={setShowSelectedBasin}
                  onClose={() => {
                    clearSelectedStation()
                    setExpertMobileConsoleOpen(false)
                  }}
                />
              ) : place ? (
                <ExpertIntelligenceReport
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
                  onSelectPlace={handlePlaceSelect}
                  terrain={terrain}
                  terrainLoading={terrainLoading}
                  siteAssessment={siteAssessment}
                  siteLoading={siteLoading}
                  loading={placeConditions.loading}
                  liveReadings={liveReadings}
                  theme={theme}
                  onClose={() => {
                    clearPlace()
                    setExpertMobileConsoleOpen(false)
                  }}
                  onSelectStation={handleSelectStation}
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
            impactSummary={nationalImpactSummary}
            urbanFlashSummary={nationalUrbanFlashSummary}
            theme={theme}
            onSelectStation={handleSelectStation}
            onSelectUrbanFlash={handleSelectUrbanFlash}
            onViewReports={focusCommunityReport}
            collapsed={analyticsCollapsed}
            onToggleCollapsed={() => setAnalyticsCollapsed((v) => !v)}
          />
        </div>
      )}

      <DisclaimerBar theme={theme} />
    </div>
  )
}
