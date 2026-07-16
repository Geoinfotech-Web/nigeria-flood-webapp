import React, { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import MapPanel from './components/MapPanel'
import StationList from './components/StationList'
import GaugeChart from './components/GaugeChart'
import RainfallChart from './components/RainfallChart'
import PredictionPanel from './components/PredictionPanel'
import PublicHeader from './components/PublicHeader'
import PlaceBriefPanel from './components/PlaceBriefPanel'
import NationalAlertsStrip from './components/NationalAlertsStrip'
import DisclaimerBar from './components/DisclaimerBar'
import FloodIncidentReporter from './components/FloodIncidentReporter'
import FloodSafeRouting from './components/FloodSafeRouting'
import { IconX } from './components/Icons'
import { useGaugeFeed } from './hooks/useGaugeFeed'
import { useStations } from './hooks/useStations'
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
  const [place, setPlace] = useState(() => readPlaceFromUrl())
  const [highlightedRoad, setHighlightedRoad] = useState(null)
  const [reportOpen, setReportOpen] = useState(false)
  const [navigation, setNavigation] = useState(null)
  const [buildingsTabActive, setBuildingsTabActive] = useState(false)
  const [viewportBuildings, setViewportBuildings] = useState(null)

  const handleBuildingsViewportChange = useCallback((payload) => {
    setViewportBuildings(payload)
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

  const clearSelectedStation = () => setSelected(null)
  const handleSelectStation = (stationId) => {
    setSelected((current) => (current === stationId ? null : stationId))
  }

  const clearPlace = () => {
    setPlace(null)
    setSelected(null)
    setHighlightedRoad(null)
    setBuildingsTabActive(false)
    setViewportBuildings(null)
  }

  const handleAlertStation = (stationName) => {
    const match = sortedStations.find((s) => s.name === stationName)
    if (match) {
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
        onReportFlood={() => setReportOpen(true)}
        routingControl={<FloodSafeRouting theme={theme} onNavigationChange={setNavigation} inline expert={mode === 'expert'} />}
      />

      <FloodIncidentReporter
        theme={theme}
        open={reportOpen}
        onOpenChange={setReportOpen}
        showTrigger={false}
      />

      {mode === 'public' ? (
        <div className="relative flex min-h-0 flex-1 flex-col md:flex-row">
          {/* Place brief — bottom sheet on mobile, side panel on desktop */}
          <aside
            className={clsx(
              'z-20 order-2 w-full shrink-0 md:order-1 md:w-[22rem] lg:w-[24rem]',
              navigation || place
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
            />
          </main>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <aside
            className={clsx(
              'hidden w-60 shrink-0 overflow-y-auto border-r sm:block',
              theme === 'dark' ? 'border-gray-800 bg-gray-900/60' : 'border-slate-200 bg-white/90',
            )}
          >
            <StationList
              stations={sortedStations}
              liveReadings={liveReadings}
              selected={selected}
              onSelect={handleSelectStation}
              onReset={clearSelectedStation}
              theme={theme}
            />
          </aside>

          <main className="relative min-h-0 flex-1">
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
            />
          </main>

          {selectedStation && (
            <aside
              className={clsx(
                'absolute inset-x-0 bottom-0 z-30 max-h-[55vh] overflow-y-auto border-t md:static md:inset-auto md:z-auto md:max-h-none md:w-[24rem] md:shrink-0 md:border-l md:border-t-0',
                theme === 'dark'
                  ? 'border-gray-800 bg-gray-900/95'
                  : 'border-slate-200 bg-white/95',
              )}
            >
              <div
                className={clsx(
                  'border-b px-4 pt-4 pb-3',
                  theme === 'dark' ? 'border-gray-800' : 'border-slate-200',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p
                      className={clsx(
                        'mb-1 text-[10px] font-semibold uppercase tracking-widest',
                        theme === 'dark' ? 'text-gray-500' : 'text-slate-500',
                      )}
                    >
                      Selected Station
                    </p>
                    <h2
                      className={clsx(
                        'text-sm font-semibold leading-tight',
                        theme === 'dark' ? 'text-white' : 'text-slate-900',
                      )}
                    >
                      {selectedStation.name}
                    </h2>
                    <p
                      className={clsx(
                        'mt-0.5 text-xs',
                        theme === 'dark' ? 'text-gray-400' : 'text-slate-500',
                      )}
                    >
                      {selectedStation.river} &middot; {selectedStation.state}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={clearSelectedStation}
                    className={clsx(
                      'inline-flex h-8 w-8 items-center justify-center rounded-lg border transition',
                      theme === 'dark'
                        ? 'border-gray-700/70 bg-gray-800/70 text-gray-400 hover:border-gray-600 hover:bg-gray-800 hover:text-white'
                        : 'border-slate-200 bg-slate-100 text-slate-500 hover:border-slate-300 hover:bg-white hover:text-slate-900',
                    )}
                    aria-label="Close selected station panel"
                    title="Close panel"
                  >
                    <IconX size={14} />
                  </button>
                </div>
              </div>

              <div className="space-y-5 p-4">
                <PredictionPanel stationId={selected} theme={theme} />
                <div
                  className={clsx(
                    'border-t',
                    theme === 'dark' ? 'border-gray-800' : 'border-slate-200',
                  )}
                />
                <GaugeChart
                  stationId={selected}
                  liveReading={liveReadings[selected]}
                  theme={theme}
                />
                <div
                  className={clsx(
                    'border-t',
                    theme === 'dark' ? 'border-gray-800' : 'border-slate-200',
                  )}
                />
                <RainfallChart
                  stationId={selected}
                  stationName={selectedStation.name}
                  theme={theme}
                />
              </div>
            </aside>
          )}
        </div>
      )}

      <DisclaimerBar theme={theme} />
    </div>
  )
}
