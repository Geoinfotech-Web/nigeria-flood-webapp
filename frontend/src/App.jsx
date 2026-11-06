import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import MapPanel from './components/MapPanel'
import ExpertOverviewPanel from './components/ExpertOverviewPanel'
import ExpertKpiStrip from './components/ExpertKpiStrip'
import ExpertAnalyticsRow from './components/ExpertAnalyticsRow'
import StationConsole from './components/StationConsole'
import AtRiskPlacesPanel from './components/AtRiskPlacesPanel'
import DevelopersPage from './components/DevelopersPage'
import PublicHeader from './components/PublicHeader'
import PlaceForecastSheet from './components/PlaceForecastSheet'
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
import { useHistoricalHotspotsSummary } from './hooks/useHistoricalHotspotsSummary'
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
import PublicListsDock from './components/PublicListsDock'
import RouteConditionsPanel from './components/RouteConditionsPanel'
import AdminApp from './components/admin/AdminApp'
import { worstRisk } from './lib/riskCopy'

function operationalRiskFromMappedZone(zone) {
  const tier = zone?.risk_tier
  if (tier === 'Emergency' || tier === 'Very High') return 'Emergency'
  if (tier === 'Warning' || tier === 'High' || tier === 'Highly Likely') return 'Warning'
  if (tier === 'Watch' || tier === 'Moderate' || tier === 'Likely') return 'Watch'
  return 'Unknown'
}

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

function readAdminFromUrl() {
  try {
    const params = new URLSearchParams(window.location.search)
    if (params.get('admin') === '1') return true
    const hash = (window.location.hash || '').replace(/^#/, '')
    return hash === '/admin' || hash === 'admin'
  } catch {
    return false
  }
}

/** Flip to "1" in .env.production after Paystack + admin flows are verified. */
const PUBLIC_API_TAB_ENABLED = import.meta.env.VITE_PUBLIC_API_TAB === '1'

export default function App() {
  const { stations } = useStations()
  const liveReadings = useGaugeFeed()
  const [theme, setTheme] = useState('light')
  const [basemap, setBasemap] = useState('streets')
  const [adminMode, setAdminMode] = useState(() => readAdminFromUrl())
  const [mode, setMode] = useState(() => (readApiPreviewFromUrl() ? 'developers' : 'public'))
  const apiPreview = readApiPreviewFromUrl()
  const [selected, setSelected] = useState(null)
  const [showSelectedBasin, setShowSelectedBasin] = useState(false)
  const [stationMapFocus, setStationMapFocus] = useState(null)
  const [place, setPlace] = useState(() => readPlaceFromUrl())
  const [zoneFocus, setZoneFocus] = useState(null)
  const [communityReportFocus, setCommunityReportFocus] = useState(null)
  const [newsFocus, setNewsFocus] = useState(null)
  const [dockNewsArticles, setDockNewsArticles] = useState(null)
  const [publicLists, setPublicLists] = useState({
    places: false,
    news: false,
    community: false,
  })
  const publicListCount =
    (publicLists.places ? 1 : 0) + (publicLists.news ? 1 : 0) + (publicLists.community ? 1 : 0)
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
  const mapCaptureRef = useRef(null)

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
  const { summary: historicalHotspotsSummary } = useHistoricalHotspotsSummary({
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
  const { assessment: siteAssessment, loading: siteLoading } = useSiteAssessment(place)
  const urbanFlashInside = useMemo(
    () => (siteAssessment?.zones_inside || []).filter((zone) => zone?.source === 'urban_flash_flood'),
    [siteAssessment?.zones_inside],
  )
  const mappedZoneRisk = useMemo(() => {
    const tiers = urbanFlashInside.map(operationalRiskFromMappedZone)
    if (place?.source === 'urban_flash_flood') {
      tiers.push(operationalRiskFromMappedZone({ risk_tier: place.urban_flash_tier }))
    }
    return worstRisk(tiers)
  }, [place?.source, place?.urban_flash_tier, urbanFlashInside])
  const effectiveOverallRisk = useMemo(
    () => worstRisk([placeConditions.overallRisk, mappedZoneRisk === 'Unknown' ? null : mappedZoneRisk]),
    [mappedZoneRisk, placeConditions.overallRisk],
  )
  const effectiveLocalSummary = useMemo(() => {
    const hasHighlyLikelyUrbanFlash = urbanFlashInside.some(
      (zone) => zone?.risk_tier === 'Highly Likely',
    ) || (place?.source === 'urban_flash_flood' && place?.urban_flash_tier === 'Highly Likely')
    if (!hasHighlyLikelyUrbanFlash) return localSummary
    return {
      ...(localSummary || {}),
      total: Math.max(Number(localSummary?.total || 0), 1),
      highly_likely: Math.max(Number(localSummary?.highly_likely || 0), 1),
    }
  }, [localSummary, place?.source, place?.urban_flash_tier, urbanFlashInside])

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

  const stripSummary = place ? effectiveLocalSummary : nationalAffectedSummary
  const stripLoading = place ? settlementsLoading || siteLoading : affectedLoading
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
    // Keep the active place / user location on the map — only swap the side panel
    // to gauge details. Use "Show gauge location" to fly the map.
    setZoneFocus(null)
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
  const showStationOnMap = useCallback((stationId) => {
    if (!stationId) return
    setStationMapFocus({ id: stationId, nonce: Date.now() })
  }, [])

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
    const lat = Number(area.lat)
    const lon = Number(area.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      setZoneFocus(area)
      return
    }
    setSelected(null)
    setShowSelectedBasin(false)
    setHighlightedRoad(null)
    setBuildingsTabActive(false)
    setViewportBuildings(null)
    setZoneFocus(area)
    setExpertMobileConsoleOpen(true)
    setPlace({
      name: area.name || 'Urban flash zone',
      display_name: [area.name || 'Urban flash zone', area.state, 'Nigeria']
        .filter(Boolean)
        .join(', '),
      lat,
      lon,
      bbox_lnglat: area.bbox_lnglat || null,
      state: area.state || null,
      class: area.admin_level || 'Urban flash',
      source: 'urban_flash_flood',
      urban_flash_tier: area.risk_tier || null,
      from_geolocation: false,
      focusAt: Date.now(),
    })
  }, [])

  const handleSelectHistoricalHotspot = useCallback((area) => {
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

  if (adminMode) {
    return (
      <div className={clsx('flex h-[100dvh] flex-col transition-colors', publicShell)}>
        <AdminApp
          theme={theme}
          onExit={() => {
            setAdminMode(false)
            try {
              const url = new URL(window.location.href)
              url.searchParams.delete('admin')
              if (url.hash === '#/admin' || url.hash === '#admin') url.hash = ''
              window.history.replaceState({}, '', url)
            } catch {
              /* ignore */
            }
          }}
        />
      </div>
    )
  }

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
        publicApiEnabled={PUBLIC_API_TAB_ENABLED}
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
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="relative flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
            <aside
              className={clsx(
                'z-20 order-2 flex w-full shrink-0 flex-col overflow-hidden md:order-1',
                // While a place sheet is open and no gauge is selected, hide the
                // left rail on phones (the place sheet owns the bottom). If a
                // gauge is selected, show the gauge panel instead — keep place on map.
                place && !selectedStation && !navigation
                  ? 'hidden md:flex md:h-full md:w-[22rem] lg:w-[24rem]'
                  : navigation || selectedStation
                    ? 'h-[min(48vh,26rem)] rounded-t-2xl border-t md:h-full md:max-h-none md:w-[22rem] md:rounded-none md:border-t-0 lg:w-[24rem]'
                    : clsx(
                        'h-[min(46vh,28rem)] rounded-t-2xl border-t md:h-full md:max-h-none md:rounded-none md:border-t-0',
                        publicListCount >= 3
                          ? 'md:w-[min(48rem,52vw)] lg:w-[48rem]'
                          : publicListCount === 2
                            ? 'md:w-[min(36rem,46vw)] lg:w-[36rem]'
                            : 'md:w-[22rem] lg:w-[24rem]',
                      ),
                theme === 'dark'
                  ? 'border-gray-800 bg-gray-950/95'
                  : 'border-slate-200 bg-white',
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
                    onShowLocation={showStationOnMap}
                    onClose={clearSelectedStation}
                  />
                </div>
              ) : (
                <PublicListsDock
                  theme={theme}
                  placesSummary={nationalAffectedSummary}
                  placesLoading={affectedLoading}
                  active={publicLists}
                  onActiveChange={setPublicLists}
                  onSelectPlace={handlePlaceSelect}
                  onNewsArticles={setDockNewsArticles}
                  onFocusNews={(article) => setNewsFocus({ ...article, focusKey: Date.now() })}
                  onFocusCommunityReport={focusCommunityReport}
                />
              )}
            </aside>

            <main className="relative order-1 min-h-0 min-w-0 flex-1 md:order-2">
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
                    Tap the map, search, or use the location button
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
                zoneFocus={zoneFocus}
                communityReportFocus={communityReportFocus}
                roadHighlight={highlightedRoad}
                forceBuildingsLayer={buildingsTabActive}
                onBuildingsViewportChange={handleBuildingsViewportChange}
                onPlaceSelect={handlePlaceSelect}
                onUrbanFlashSelect={handleSelectUrbanFlash}
                atRiskPlaces={nationalAffectedSummary?.places}
                externalNewsVisible={publicLists.news}
                externalNewsArticles={dockNewsArticles}
                newsFocus={newsFocus}
                showSearch={false}
                navigation={navigation}
                highlightSelectedBasin={showSelectedBasin}
                mapCaptureRef={mapCaptureRef}
                bottomSheetOverlay={Boolean(place)}
                stationFocus={stationMapFocus}
              />
              {place && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center p-0 sm:px-3 sm:pb-3">
                  <div className="pointer-events-auto flex h-[min(34vh,20rem)] w-full flex-col overflow-hidden md:h-[min(32vh,19rem)]">
                    <PlaceForecastSheet
                      place={place}
                      overallRisk={effectiveOverallRisk}
                      primaryStation={placeConditions.primaryStation}
                      siteAssessment={siteAssessment}
                      nearby={placeConditions.nearby}
                      nearbySettlements={settlements}
                      localSettlementSummary={effectiveLocalSummary}
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
                      captureMapSnapshot={() => mapCaptureRef.current?.() ?? Promise.resolve(null)}
                    />
                  </div>
                </div>
              )}
            </main>
          </div>
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <ExpertKpiStrip
            place={place}
            placeConditions={placeConditions}
            localSettlementSummary={effectiveLocalSummary}
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
                onUrbanFlashSelect={handleSelectUrbanFlash}
                atRiskPlaces={affectedSettlements?.places}
                externalNewsArticles={dockNewsArticles}
                newsFocus={newsFocus}
                showSearch={false}
                navigation={navigation}
                highlightSelectedBasin={showSelectedBasin}
                bottomSheetOverlay={Boolean(
                  selectedStation || place || expertMobileConsoleOpen,
                )}
                mapCaptureRef={mapCaptureRef}
                stationFocus={stationMapFocus}
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
                  onShowLocation={showStationOnMap}
                  onClose={() => {
                    clearSelectedStation()
                    setExpertMobileConsoleOpen(false)
                  }}
                />
              ) : place ? (
                <ExpertIntelligenceReport
                  place={place}
                  overallRisk={effectiveOverallRisk}
                  primaryStation={placeConditions.primaryStation}
                  nearby={placeConditions.nearby}
                  nearbySettlements={settlements}
                  localSettlementSummary={effectiveLocalSummary}
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
                  captureMapSnapshot={() => mapCaptureRef.current?.() ?? Promise.resolve(null)}
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
            historicalHotspotsSummary={historicalHotspotsSummary}
            theme={theme}
            onSelectStation={handleSelectStation}
            onSelectUrbanFlash={handleSelectUrbanFlash}
            onSelectHistoricalHotspot={handleSelectHistoricalHotspot}
            onViewReports={focusCommunityReport}
            onFocusNews={(article) => setNewsFocus({ ...article, focusKey: Date.now() })}
            onNewsArticles={setDockNewsArticles}
            collapsed={analyticsCollapsed}
            onToggleCollapsed={() => setAnalyticsCollapsed((v) => !v)}
          />
        </div>
      )}

      <DisclaimerBar theme={theme} />
    </div>
  )
}
