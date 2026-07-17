import React, { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import clsx from 'clsx'
import SearchBar from './SearchBar'
import BasemapSwitcher from './BasemapSwitcher'
import FloodRiskLegend from './FloodRiskLegend'
import ImpactSummaryPanel from './ImpactSummaryPanel'
import LayersPanel from './LayersPanel'
import { IconHome } from './Icons'
import { SUSCEPTIBILITY_COLOR } from '../lib/riskCopy'

const RISK_COLOR = {
  Normal:    '#22c55e',
  Watch:     '#eab308',
  Warning:   '#f97316',
  Emergency: '#ef4444',
  Moderate:  '#93c5fd',
  High:      '#2563eb',
  'Very High': '#1e3a8a',
  // Urban flash / legacy inundation labels
  Likely:    '#3b82f6',
  'Highly Likely': '#1e3a8a',
}

/** Orange/purple urban flash ramp, separate from inundation blues. */
const URBAN_FLASH_COLOR = {
  Likely: '#f97316',
  'Highly Likely': '#86198f',
}

// ── Basemap definitions ──────────────────────────────────────────────────────
export const BASEMAPS = [
  {
    id:    'dark',
    label: 'Dark',
    style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
  },
  {
    id:    'light',
    label: 'Light',
    style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  },
  {
    id:    'streets',
    label: 'Streets',
    style: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
  },
  {
    id:    'satellite',
    label: 'Satellite',
    style: {
      version: 8,
      sources: {
        esri_satellite: {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          attribution: '© Esri',
          maxzoom: 19,
        },
        esri_labels: {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          attribution: '© Esri',
          maxzoom: 19,
        },
      },
      layers: [
        { id: 'satellite-tiles', type: 'raster', source: 'esri_satellite' },
        { id: 'label-tiles',     type: 'raster', source: 'esri_labels', paint: { 'raster-opacity': 0.8 } },
      ],
    },
  },
  {
    id:    'topo',
    label: 'Topo',
    style: {
      version: 8,
      sources: {
        opentopomap: {
          type: 'raster',
          tiles: ['https://tile.opentopomap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '© OpenTopoMap',
          maxzoom: 17,
        },
      },
      layers: [{ id: 'topo-tiles', type: 'raster', source: 'opentopomap' }],
    },
  },
]

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const DEFAULT_NIGERIA_BOUNDS = [
  [2.65, 4.2],
  [14.75, 13.95],
]
const ROAD_LAYER_STYLES = [
  { key: 'highway', className: 'Highway', color: '#f59e0b', minzoom: 5, dash: undefined, width: [5, 1.2, 8, 2.2, 11, 4, 13, 6] },
  { key: 'major', className: 'Major Road', color: '#fb923c', minzoom: 6, dash: undefined, width: [6, 0.8, 9, 1.8, 12, 3, 14, 4.5] },
  { key: 'secondary', className: 'Secondary Road', color: '#38bdf8', minzoom: 7, dash: undefined, width: [7, 0.6, 10, 1.3, 13, 2.4] },
  { key: 'tertiary', className: 'Tertiary Road', color: '#cbd5e1', minzoom: 9, dash: [1.4, 1.2], width: [9, 0.5, 12, 1.1, 14, 1.8] },
]
const PLACE_LAYER_STYLES = [
  { key: 'city', className: 'City', color: '#f8fafc', radius: [5, 3.2, 9, 4.5, 12, 6], minzoom: 5, textSize: [5, 11, 9, 13, 12, 15] },
  { key: 'town', className: 'Town', color: '#cbd5e1', radius: [7, 2.6, 10, 3.8, 13, 4.8], minzoom: 7, textSize: [7, 10, 10, 12, 13, 13] },
  { key: 'village', className: 'Village', color: '#94a3b8', radius: [9, 2.2, 12, 3.2, 14, 4], minzoom: 9, textSize: [9, 9, 12, 10, 14, 11] },
]

function interpolateWidth(stops) {
  return ['interpolate', ['linear'], ['zoom'], ...stops]
}

function registerPointerCursor(map, layerId) {
  map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer' })
  map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = '' })
}

function addRoadLayers(map, sourceId) {
  ROAD_LAYER_STYLES.forEach(style => {
    const layerId = `exposure-roads-${style.key}`
    if (map.getLayer(layerId)) return
    map.addLayer({
      id: layerId,
      type: 'line',
      source: sourceId,
      minzoom: style.minzoom,
      filter: ['==', ['get', 'class'], style.className],
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': style.color,
        'line-opacity': 0.8,
        'line-width': interpolateWidth(style.width),
        ...(style.dash ? { 'line-dasharray': style.dash } : {}),
      },
    })

    map.on('click', layerId, e => {
      const props = e.features?.[0]?.properties || {}
      new maplibregl.Popup({ closeButton: false, maxWidth: '240px' })
        .setLngLat(e.lngLat)
        .setHTML(`
          <div style="padding:10px 12px;font-size:12px;color:#e5e7eb;line-height:1.6">
            <div style="font-weight:600;font-size:13px;color:#f9fafb;margin-bottom:4px">${props.name || props.ref || 'Unnamed road'}</div>
            <div style="display:flex;justify-content:space-between;margin-bottom:2px">
              <span style="color:#6b7280">Class</span>
              <span style="font-weight:600;color:${style.color}">${props.class || style.className}</span>
            </div>
            ${props.ref ? `<div style="display:flex;justify-content:space-between;margin-bottom:2px"><span style="color:#6b7280">Ref</span><span>${props.ref}</span></div>` : ''}
            ${props.surface ? `<div style="display:flex;justify-content:space-between"><span style="color:#6b7280">Surface</span><span>${props.surface}</span></div>` : ''}
          </div>
        `)
        .addTo(map)
    })
    registerPointerCursor(map, layerId)
  })
}

function addAdminBoundaryLayers(map, sourceId, layerKey) {
  const fillId = `admin-${layerKey}-fill`
  const lineId = `admin-${layerKey}-line`
  const labelId = `admin-${layerKey}-label`
  const isState = layerKey === 'states'
  const lineColor = isState ? '#0f766e' : '#64748b'
  const fillColor = isState ? '#14b8a6' : '#94a3b8'
  const minzoom = isState ? 4 : 7
  const labelMinzoom = isState ? 5 : 9

  if (!map.getLayer(fillId)) {
    map.addLayer({
      id: fillId,
      type: 'fill',
      source: sourceId,
      minzoom,
      paint: {
        'fill-color': fillColor,
        'fill-opacity': 0.06,
      },
    })
  }
  if (!map.getLayer(lineId)) {
    map.addLayer({
      id: lineId,
      type: 'line',
      source: sourceId,
      minzoom,
      paint: {
        'line-color': lineColor,
        'line-width': isState
          ? ['interpolate', ['linear'], ['zoom'], 4, 1.2, 8, 2.2, 12, 2.8]
          : ['interpolate', ['linear'], ['zoom'], 7, 0.6, 10, 1.2, 13, 1.8],
        'line-opacity': 0.85,
      },
    })
  }
  if (!map.getLayer(labelId)) {
    map.addLayer({
      id: labelId,
      type: 'symbol',
      source: sourceId,
      minzoom: labelMinzoom,
      layout: {
        'text-field': ['get', 'name'],
        'text-size': isState
          ? ['interpolate', ['linear'], ['zoom'], 5, 10, 8, 13, 11, 15]
          : ['interpolate', ['linear'], ['zoom'], 9, 9, 12, 11, 14, 12],
        'text-font': ['Open Sans Regular'],
        'text-max-width': 10,
        'text-padding': 2,
        'symbol-placement': 'point',
      },
      paint: {
        'text-color': isState ? '#0f766e' : '#475569',
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.4,
      },
    })
  }

  if (!map._adminPopupBound?.[layerKey]) {
    map._adminPopupBound = map._adminPopupBound || {}
    map._adminPopupBound[layerKey] = true
    map.on('click', fillId, (e) => {
      const props = e.features?.[0]?.properties || {}
      new maplibregl.Popup({ closeButton: false, maxWidth: '220px' })
        .setLngLat(e.lngLat)
        .setHTML(`
          <div style="padding:10px 12px;font-size:12px;color:#e5e7eb;line-height:1.6">
            <div style="font-weight:600;font-size:13px;color:#f9fafb;margin-bottom:4px">${props.name || 'Boundary'}</div>
            <div style="display:flex;justify-content:space-between;margin-bottom:2px">
              <span style="color:#6b7280">Level</span>
              <span>${isState ? 'State' : 'LGA'}</span>
            </div>
            ${props.state && !isState ? `<div style="display:flex;justify-content:space-between"><span style="color:#6b7280">State</span><span>${props.state}</span></div>` : ''}
          </div>
        `)
        .addTo(map)
    })
    registerPointerCursor(map, fillId)
  }
}

function addBuildingLayer(map, sourceId) {
  if (map.getLayer('exposure-buildings')) return
  map.addLayer({
    id: 'exposure-buildings',
    type: 'circle',
    source: sourceId,
    minzoom: 11,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.2, 14, 4.5, 16, 6],
      'circle-color': [
        'case',
        ['==', ['get', 'susceptibility'], 'Highly Susceptible'], '#800026',
        ['==', ['get', 'susceptibility'], 'High'], '#e31a1c',
        ['==', ['get', 'susceptibility'], 'Moderate'], '#fd8d3c',
        ['==', ['get', 'susceptibility'], 'Low'], '#ffffb2',
        ['==', ['get', 'zone_tier'], 'Emergency'], '#ef4444',
        ['==', ['get', 'zone_tier'], 'Warning'], '#f97316',
        ['==', ['get', 'zone_tier'], 'Watch'], '#eab308',
        '#c4b5fd',
      ],
      'circle-stroke-width': 1,
      'circle-stroke-color': [
        'case',
        ['==', ['get', 'susceptibility'], 'Low'], '#a16207',
        '#4c1d95',
      ],
      'circle-opacity': 0.9,
    },
  })

  map.on('click', 'exposure-buildings', (e) => {
    const props = e.features?.[0]?.properties || {}
    new maplibregl.Popup({ closeButton: false, maxWidth: '240px' })
      .setLngLat(e.lngLat)
      .setHTML(`
        <div style="padding:10px 12px;font-size:12px;color:#e5e7eb;line-height:1.6">
          <div style="font-weight:600;font-size:13px;color:#f9fafb;margin-bottom:4px">${props.name || 'Building'}</div>
          <div style="display:flex;justify-content:space-between;margin-bottom:2px">
            <span style="color:#6b7280">Type</span>
            <span>${props.class || 'Building'}</span>
          </div>
          ${props.susceptibility ? `<div style="display:flex;justify-content:space-between;margin-bottom:2px"><span style="color:#6b7280">Susceptibility</span><span style="font-weight:600">${props.susceptibility}</span></div>` : ''}
          ${props.zone_tier ? `<div style="display:flex;justify-content:space-between"><span style="color:#6b7280">Flood zone</span><span style="font-weight:600">${props.zone_tier}</span></div>` : '<div style="color:#6b7280">Outside elevated flood zone</div>'}
        </div>
      `)
      .addTo(map)
  })
  registerPointerCursor(map, 'exposure-buildings')
}

function addBridgeLayer(map, sourceId) {
  if (!map.getLayer('exposure-bridges')) {
    map.addLayer({
      id: 'exposure-bridges',
      type: 'circle',
      source: sourceId,
      minzoom: 8,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 2.5, 11, 4.5, 14, 6],
        'circle-color': '#fde68a',
        'circle-stroke-width': 1.6,
        'circle-stroke-color': '#7c2d12',
        'circle-opacity': 0.92,
      },
    })

    map.on('click', 'exposure-bridges', e => {
      const props = e.features?.[0]?.properties || {}
      new maplibregl.Popup({ closeButton: false, maxWidth: '220px' })
        .setLngLat(e.lngLat)
        .setHTML(`
          <div style="padding:10px 12px;font-size:12px;color:#e5e7eb;line-height:1.6">
            <div style="font-weight:600;font-size:13px;color:#f9fafb;margin-bottom:4px">${props.name || props.ref || 'Bridge crossing'}</div>
            <div style="display:flex;justify-content:space-between;margin-bottom:2px">
              <span style="color:#6b7280">Type</span>
              <span style="font-weight:600;color:#fde68a">${props.class || 'Bridge'}</span>
            </div>
            ${props.highway ? `<div style="display:flex;justify-content:space-between"><span style="color:#6b7280">Highway tag</span><span>${props.highway}</span></div>` : ''}
          </div>
        `)
        .addTo(map)
    })
    registerPointerCursor(map, 'exposure-bridges')
  }
}

function addPlaceLayers(map, sourceId) {
  PLACE_LAYER_STYLES.forEach(style => {
    const circleId = `exposure-places-${style.key}-circle`
    const labelId = `exposure-places-${style.key}-label`

    if (!map.getLayer(circleId)) {
      map.addLayer({
        id: circleId,
        type: 'circle',
        source: sourceId,
        minzoom: style.minzoom,
        filter: ['==', ['get', 'class'], style.className],
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], ...style.radius],
          'circle-color': style.color,
          'circle-stroke-width': 1.2,
          'circle-stroke-color': '#0f172a',
          'circle-opacity': 0.9,
        },
      })

      map.on('click', circleId, e => {
        const props = e.features?.[0]?.properties || {}
        new maplibregl.Popup({ closeButton: false, maxWidth: '220px' })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="padding:10px 12px;font-size:12px;color:#e5e7eb;line-height:1.6">
              <div style="font-weight:600;font-size:13px;color:#f9fafb;margin-bottom:4px">${props.name || 'Unnamed place'}</div>
              <div style="display:flex;justify-content:space-between;margin-bottom:2px">
                <span style="color:#6b7280">Class</span>
                <span style="font-weight:600;color:${style.color}">${props.class || style.className}</span>
              </div>
              ${props.population ? `<div style="display:flex;justify-content:space-between"><span style="color:#6b7280">Population</span><span>${Number(props.population).toLocaleString()}</span></div>` : ''}
            </div>
          `)
          .addTo(map)
      })
      registerPointerCursor(map, circleId)
    }

    if (!map.getLayer(labelId)) {
      map.addLayer({
        id: labelId,
        type: 'symbol',
        source: sourceId,
        minzoom: style.minzoom,
        filter: ['==', ['get', 'class'], style.className],
        layout: {
          'text-field': ['get', 'name'],
          'text-size': ['interpolate', ['linear'], ['zoom'], ...style.textSize],
          'text-font': ['Open Sans Regular'],
          'text-offset': [0, 1.15],
          'text-anchor': 'top',
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': style.color,
          'text-halo-color': '#0f172a',
          'text-halo-width': 1.1,
          'text-opacity': 0.9,
        },
      })
    }
  })
}

export default function MapPanel({
  stations,
  liveReadings,
  selected,
  onSelect,
  basemap,
  onBasemapChange,
  theme = 'dark',
  variant = 'expert',
  placeFocus = null,
  roadHighlight = null,
  forceBuildingsLayer = false,
  onBuildingsViewportChange = null,
  onPlaceSelect,
  showSearch = true,
  navigation = null,
}) {
  const publicMode = variant === 'public'
  const mapRef     = useRef(null)
  const mapObj     = useRef(null)
  const markersRef = useRef({})
  const [riskAreasVisible, setRiskAreasVisible] = useState(true)
  const [urbanFlashVisible, setUrbanFlashVisible] = useState(true)
  const [urbanFlashOpacity, setUrbanFlashOpacity] = useState(0.6)
  const [gaugesVisible, setGaugesVisible] = useState(true)
  const [riskOpacity, setRiskOpacity] = useState(0.6)
  const [riskData,    setRiskData]    = useState(null)
  const [urbanFlashData, setUrbanFlashData] = useState(null)
  const [mapReady,    setMapReady]    = useState(false)
  const [tileLayers,  setTileLayers]  = useState([])
  /** Independent raster toggles keyed by layer source, e.g. jrc_occurrence */
  const [tileVisibility, setTileVisibility] = useState({})
  const [impactSummary, setImpactSummary] = useState(null)
  const [selectedRiskArea, setSelectedRiskArea] = useState(null)
  const [exposureMeta, setExposureMeta] = useState([])
  const [exposureData, setExposureData] = useState({
    roads: null,
    bridges: null,
    places: null,
    buildings: null,
  })
  const [exposureVisible, setExposureVisible] = useState({
    roads: false,
    bridges: false,
    places: false,
    buildings: false,
  })
  const [boundaryMeta, setBoundaryMeta] = useState([])
  const [boundaryData, setBoundaryData] = useState({ states: null, lgas: null })
  const [boundaryVisible, setBoundaryVisible] = useState({ states: false, lgas: false })
  const [buildingsStatus, setBuildingsStatus] = useState(null) // loading | ready | zoom | error
  const buildingsFetchRef = useRef(0)
  const resetToHomeView = useCallback(() => {
    if (!mapObj.current) return
    mapObj.current.fitBounds(DEFAULT_NIGERIA_BOUNDS, {
      padding: { top: 48, right: 48, bottom: 48, left: 48 },
      duration: 1200,
    })
  }, [])
  const toggleExposureLayer = useCallback((layerId) => {
    setExposureVisible(current => ({ ...current, [layerId]: !current[layerId] }))
  }, [])
  const toggleBoundaryLayer = useCallback((layerId) => {
    setBoundaryVisible((current) => ({ ...current, [layerId]: !current[layerId] }))
  }, [])
  const toggleTileLayer = useCallback((source) => {
    setTileVisibility((current) => ({ ...current, [source]: !current[source] }))
  }, [])

  useEffect(() => {
    if (!mapReady || !mapObj.current) return
    const map = mapObj.current
    if (!navigation) {
      if (map.getLayer('safe-route-line')) map.removeLayer('safe-route-line')
      if (map.getLayer('safe-route-points')) map.removeLayer('safe-route-points')
      if (map.getSource('safe-route')) map.removeSource('safe-route')
      if (map.getSource('safe-route-points')) map.removeSource('safe-route-points')
      return
    }
    if (map.getSource('safe-route')) map.getSource('safe-route').setData(navigation.route)
    else {
      map.addSource('safe-route', { type: 'geojson', data: navigation.route })
      map.addLayer({ id: 'safe-route-line', type: 'line', source: 'safe-route', paint: { 'line-color': navigation.safe ? '#0284c7' : '#ef4444', 'line-width': 6, 'line-opacity': 0.9 } })
    }
    if (map.getLayer('safe-route-line')) map.setPaintProperty('safe-route-line', 'line-color', navigation.safe ? '#0284c7' : '#ef4444')
    const points = { type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { kind: 'current' }, geometry: { type: 'Point', coordinates: [navigation.current.lon, navigation.current.lat] } },
      { type: 'Feature', properties: { kind: 'destination' }, geometry: { type: 'Point', coordinates: [Number(navigation.destination.lon), Number(navigation.destination.lat)] } },
    ] }
    if (map.getSource('safe-route-points')) map.getSource('safe-route-points').setData(points)
    else {
      map.addSource('safe-route-points', { type: 'geojson', data: points })
      map.addLayer({ id: 'safe-route-points', type: 'circle', source: 'safe-route-points', paint: { 'circle-radius': 7, 'circle-color': ['match', ['get', 'kind'], 'current', '#22c55e', '#0284c7'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } })
    }
  }, [mapReady, navigation])

  // ── Init map ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const style = BASEMAPS.find(b => b.id === basemap)?.style
    mapObj.current = new maplibregl.Map({
      container: mapRef.current,
      style,
      center: [8.0, 9.0],
      zoom: 5.5,
      minZoom: 4,
    })
    mapObj.current.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      'top-right',
    )
    mapObj.current.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
    mapObj.current.addControl(new maplibregl.FullscreenControl(), 'bottom-right')

    mapObj.current.on('load', () => setMapReady(true))
    return () => { mapObj.current?.remove(); setMapReady(false) }
  }, [basemap])

  // ── Load flood risk GeoJSON ────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API}/flood-risk/geojson`)
      .then(r => r.json())
      .then(setRiskData)
      .catch(console.error)
  }, [])

  // ── Load urban flash flood GeoJSON (separate source) ───────────────────────
  useEffect(() => {
    fetch(`${API}/flood-risk/geojson?source=urban_flash_flood`)
      .then((r) => r.json())
      .then(setUrbanFlashData)
      .catch(console.error)
  }, [])

  // ── Load available raster tile layers ─────────────────────────────────────
  useEffect(() => {
    fetch(`${API}/flood-risk/layers`)
      .then(r => r.json())
      .then(layers => {
        setTileLayers(layers)
        // Default: Inundation History on, susceptibility off
        setTileVisibility((current) => {
          const next = { ...current }
          layers.forEach((layer) => {
            if (next[layer.source] === undefined) {
              next[layer.source] = layer.source === 'jrc_occurrence'
            }
          })
          return next
        })
      })
      .catch(console.error)
  }, [])

  useEffect(() => {
    fetch(`${API}/exposure/manifest`)
      .then(r => r.json())
      .then(setExposureMeta)
      .catch(console.error)
  }, [])

  useEffect(() => {
    fetch(`${API}/boundaries/manifest`)
      .then((r) => r.json())
      .then(setBoundaryMeta)
      .catch(console.error)
  }, [])

  useEffect(() => {
    Object.entries(boundaryVisible).forEach(([layerId, visible]) => {
      if (!visible || boundaryData[layerId]) return
      fetch(`${API}/boundaries/${layerId}`)
        .then((r) => r.json())
        .then((data) => {
          setBoundaryData((current) => {
            if (current[layerId]) return current
            return { ...current, [layerId]: data }
          })
        })
        .catch(console.error)
    })
  }, [boundaryVisible, boundaryData])

  useEffect(() => {
    const loadImpactSummary = () => {
      const params = new URLSearchParams()
      if (selectedRiskArea?.name && selectedRiskArea?.admin_level) {
        params.set('area_name', selectedRiskArea.name)
        params.set('admin_level', selectedRiskArea.admin_level)
      } else if (selected) {
        params.set('station_id', String(selected))
      } else {
        setImpactSummary(null)
        return Promise.resolve()
      }

      return fetch(`${API}/flood-risk/impact-summary?${params.toString()}`)
        .then(r => r.json())
        .then(setImpactSummary)
        .catch(console.error)
    }

    loadImpactSummary()
    const id = setInterval(loadImpactSummary, 300_000)
    return () => clearInterval(id)
  }, [selected, selectedRiskArea])

  useEffect(() => {
    Object.entries(exposureVisible).forEach(([layerId, visible]) => {
      if (!visible || layerId === 'buildings' || exposureData[layerId]) return
      fetch(`${API}/exposure/${layerId}`)
        .then(r => r.json())
        .then(data => {
          setExposureData(current => {
            if (current[layerId]) return current
            return { ...current, [layerId]: data }
          })
        })
        .catch(console.error)
    })
  }, [exposureVisible, exposureData])

  // Force-on Buildings exposure when the place panel Buildings tab is active
  useEffect(() => {
    if (!forceBuildingsLayer) return
    setExposureVisible((current) =>
      current.buildings ? current : { ...current, buildings: true },
    )
  }, [forceBuildingsLayer])

  // Buildings: on-demand for current map viewport (OSM Overpass)
  useEffect(() => {
    if (!mapReady || !mapObj.current || !exposureVisible.buildings) {
      setBuildingsStatus(null)
      onBuildingsViewportChange?.(null)
      return undefined
    }

    const map = mapObj.current
    let debounceId = null

    const loadBuildings = () => {
      const zoom = map.getZoom()
      if (zoom < 11) {
        setBuildingsStatus('zoom')
        setExposureData((current) => ({
          ...current,
          buildings: { type: 'FeatureCollection', features: [] },
        }))
        onBuildingsViewportChange?.({
          buildings: [],
          summary: null,
          status: 'zoom',
        })
        return
      }

      const bounds = map.getBounds()
      const west = bounds.getWest()
      const south = bounds.getSouth()
      const east = bounds.getEast()
      const north = bounds.getNorth()
      const spanOk =
        Math.abs(north - south) <= 0.25 && Math.abs(east - west) <= 0.25
      if (!spanOk) {
        setBuildingsStatus('zoom')
        onBuildingsViewportChange?.({
          buildings: [],
          summary: null,
          status: 'zoom',
        })
        return
      }

      const requestId = ++buildingsFetchRef.current
      setBuildingsStatus('loading')
      onBuildingsViewportChange?.({
        buildings: [],
        summary: null,
        status: 'loading',
      })

      const params = new URLSearchParams({
        west: String(west),
        south: String(south),
        east: String(east),
        north: String(north),
        limit: '2000',
        with_zones: 'true',
        min_tier: 'Watch',
        list_limit: '60',
      })
      fetch(`${API}/exposure/buildings?${params.toString()}`)
        .then((r) => {
          if (!r.ok) throw new Error(`Buildings ${r.status}`)
          return r.json()
        })
        .then((data) => {
          if (requestId !== buildingsFetchRef.current) return
          setExposureData((current) => ({ ...current, buildings: data }))
          setBuildingsStatus('ready')
          onBuildingsViewportChange?.({
            buildings: Array.isArray(data?.buildings) ? data.buildings : [],
            summary: data?.summary || null,
            status: 'ready',
            bounds: { west, south, east, north },
          })
        })
        .catch((err) => {
          if (requestId !== buildingsFetchRef.current) return
          console.error(err)
          setBuildingsStatus('error')
          onBuildingsViewportChange?.({
            buildings: [],
            summary: null,
            status: 'error',
            error: err,
          })
        })
    }

    const onMoveEnd = () => {
      clearTimeout(debounceId)
      debounceId = setTimeout(loadBuildings, 650)
    }

    loadBuildings()
    map.on('moveend', onMoveEnd)
    return () => {
      clearTimeout(debounceId)
      map.off('moveend', onMoveEnd)
    }
  }, [mapReady, exposureVisible.buildings, onBuildingsViewportChange])

  // ── Add risk GeoJSON layer once map + data are ready ──────────────────────
  useEffect(() => {
    if (!mapReady || !riskData) return
    const map = mapObj.current

    if (map.getSource('flood-risk')) {
      map.getSource('flood-risk').setData(riskData)
    } else {
      map.addSource('flood-risk', { type: 'geojson', data: riskData })

      // Insert below the first symbol layer so labels stay on top
      const firstSymbol = map.getStyle().layers.find(l => l.type === 'symbol')?.id

      map.addLayer({
        id:     'flood-risk-fill',
        type:   'fill',
        source: 'flood-risk',
        paint: {
          'fill-color': [
            'match', ['get', 'risk_tier'],
            'Very High',     '#1e3a8a',
            'High',          '#2563eb',
            'Moderate',      '#93c5fd',
            'Highly Likely', '#1e3a8a',
            'Likely',        '#3b82f6',
            'Emergency',     '#ef4444',
            'Warning',       '#f97316',
            'Watch',         '#eab308',
            '#22c55e',
          ],
          'fill-opacity': riskOpacity * 0.55,
        },
      }, firstSymbol)

      map.addLayer({
        id:     'flood-risk-outline',
        type:   'line',
        source: 'flood-risk',
        paint: {
          'line-color': [
            'match', ['get', 'risk_tier'],
            'Very High',     '#1e3a8a',
            'High',          '#2563eb',
            'Moderate',      '#93c5fd',
            'Highly Likely', '#1e3a8a',
            'Likely',        '#3b82f6',
            'Emergency',     '#ef4444',
            'Warning',       '#f97316',
            'Watch',         '#eab308',
            '#22c55e',
          ],
          'line-width': 1.2,
          'line-opacity': riskOpacity,
        },
      }, firstSymbol)

      // Click on risk area → popup
      map.on('click', 'flood-risk-fill', e => {
        const p = e.features[0].properties
        setSelectedRiskArea({
          name: p.name,
          admin_level: p.admin_level,
          risk_tier: p.risk_tier,
          state: p.state,
        })
        onSelect(null)
        const tierColor = RISK_COLOR[p.risk_tier] || '#3b82f6'
        new maplibregl.Popup({ closeButton: false, maxWidth: '220px' })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="padding:10px 12px;font-size:12px;color:#e5e7eb;line-height:1.6">
              <div style="font-weight:600;font-size:13px;color:#f9fafb;margin-bottom:4px">${p.name}</div>
              <div style="color:#9ca3af;font-size:11px;margin-bottom:6px;text-transform:capitalize">${p.admin_level === 'inundation' ? 'Inundation extent' : (p.admin_level || '')}</div>
              <div style="display:flex;justify-content:space-between;margin-bottom:2px">
                <span style="color:#6b7280">Likelihood</span>
                <span style="font-weight:600;color:${tierColor}">${p.risk_tier}</span>
              </div>
              <div style="display:flex;justify-content:space-between;margin-bottom:2px">
                <span style="color:#6b7280">Score</span>
                <span style="font-weight:500">${(p.risk_score * 100).toFixed(0)}%</span>
              </div>
              <div style="display:flex;justify-content:space-between">
                <span style="color:#6b7280">Valid to</span>
                <span style="font-size:11px">${p.valid_to ?? '—'}</span>
              </div>
            </div>
          `)
          .addTo(map)
      })
      map.on('mouseenter', 'flood-risk-fill', () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', 'flood-risk-fill', () => { map.getCanvas().style.cursor = '' })
    }
  }, [mapReady, riskData])

  // ── Update risk layer visibility + opacity ─────────────────────────────────
  useEffect(() => {
    if (!mapReady) return
    const map = mapObj.current
    if (!map.getLayer('flood-risk-fill')) return
    const vis = riskAreasVisible ? 'visible' : 'none'
    map.setLayoutProperty('flood-risk-fill',    'visibility', vis)
    map.setLayoutProperty('flood-risk-outline', 'visibility', vis)
    map.setPaintProperty('flood-risk-fill',    'fill-opacity',  riskOpacity * 0.6)
    map.setPaintProperty('flood-risk-outline', 'line-opacity',  riskOpacity)
  }, [mapReady, riskAreasVisible, riskOpacity])

  // ── Add urban flash flood GeoJSON layer ────────────────────────────────────
  useEffect(() => {
    if (!mapReady || !urbanFlashData) return
    const map = mapObj.current

    if (map.getSource('urban-flash')) {
      map.getSource('urban-flash').setData(urbanFlashData)
    } else {
      map.addSource('urban-flash', { type: 'geojson', data: urbanFlashData })

      const beforeId = map.getLayer('flood-risk-fill')
        ? 'flood-risk-fill'
        : map.getStyle().layers.find((l) => l.type === 'symbol')?.id

      map.addLayer(
        {
          id: 'urban-flash-fill',
          type: 'fill',
          source: 'urban-flash',
          paint: {
            'fill-color': [
              'match',
              ['get', 'risk_tier'],
              'Highly Likely',
              URBAN_FLASH_COLOR['Highly Likely'],
              'Likely',
              URBAN_FLASH_COLOR.Likely,
              URBAN_FLASH_COLOR.Likely,
            ],
            'fill-opacity': urbanFlashOpacity * 0.55,
          },
        },
        beforeId,
      )

      map.addLayer(
        {
          id: 'urban-flash-outline',
          type: 'line',
          source: 'urban-flash',
          paint: {
            'line-color': [
              'match',
              ['get', 'risk_tier'],
              'Highly Likely',
              URBAN_FLASH_COLOR['Highly Likely'],
              'Likely',
              URBAN_FLASH_COLOR.Likely,
              URBAN_FLASH_COLOR.Likely,
            ],
            'line-width': 1.4,
            'line-opacity': urbanFlashOpacity,
          },
        },
        beforeId,
      )

      map.on('click', 'urban-flash-fill', (e) => {
        const p = e.features[0].properties
        const tierColor = URBAN_FLASH_COLOR[p.risk_tier] || URBAN_FLASH_COLOR.Likely
        new maplibregl.Popup({ closeButton: false, maxWidth: '220px' })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="padding:10px 12px;font-size:12px;color:#e5e7eb;line-height:1.6">
              <div style="font-weight:600;font-size:13px;color:#f9fafb;margin-bottom:4px">${p.name}</div>
              <div style="color:#9ca3af;font-size:11px;margin-bottom:6px">Urban flash flood</div>
              <div style="display:flex;justify-content:space-between;margin-bottom:2px">
                <span style="color:#6b7280">Likelihood</span>
                <span style="font-weight:600;color:${tierColor}">${p.risk_tier}</span>
              </div>
              <div style="display:flex;justify-content:space-between;margin-bottom:2px">
                <span style="color:#6b7280">Score</span>
                <span style="font-weight:500">${(p.risk_score * 100).toFixed(0)}%</span>
              </div>
              <div style="display:flex;justify-content:space-between">
                <span style="color:#6b7280">Valid to</span>
                <span style="font-size:11px">${p.valid_to ?? '—'}</span>
              </div>
            </div>
          `)
          .addTo(map)
      })
      map.on('mouseenter', 'urban-flash-fill', () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', 'urban-flash-fill', () => {
        map.getCanvas().style.cursor = ''
      })
    }
  }, [mapReady, urbanFlashData])

  // ── Update urban flash visibility + opacity ────────────────────────────────
  useEffect(() => {
    if (!mapReady) return
    const map = mapObj.current
    if (!map.getLayer('urban-flash-fill')) return
    const vis = urbanFlashVisible ? 'visible' : 'none'
    map.setLayoutProperty('urban-flash-fill', 'visibility', vis)
    map.setLayoutProperty('urban-flash-outline', 'visibility', vis)
    map.setPaintProperty('urban-flash-fill', 'fill-opacity', urbanFlashOpacity * 0.55)
    map.setPaintProperty('urban-flash-outline', 'line-opacity', urbanFlashOpacity)
  }, [mapReady, urbanFlashVisible, urbanFlashOpacity])

  // ── Add / sync independent raster tile layers ─────────────────────────────
  useEffect(() => {
    if (!mapReady) return
    const map = mapObj.current
    const beforeId = map.getLayer('flood-risk-fill') ? 'flood-risk-fill' : undefined

    // Remove stale raster layers
    tileLayers.forEach((layer) => {
      const layerId = `tiles-${layer.source}`
      const sourceId = `tiles-src-${layer.source}`
      const shouldShow = Boolean(tileVisibility[layer.source])
      if (!shouldShow) {
        if (map.getLayer(layerId)) map.removeLayer(layerId)
        if (map.getSource(sourceId)) map.removeSource(sourceId)
      }
    })

    // Also remove legacy single gee-tiles if present
    if (map.getLayer('gee-tiles')) map.removeLayer('gee-tiles')
    if (map.getSource('gee-tiles')) map.removeSource('gee-tiles')

    tileLayers.forEach((layer) => {
      if (!tileVisibility[layer.source]) return
      const layerId = `tiles-${layer.source}`
      const sourceId = `tiles-src-${layer.source}`
      const tileUrl = layer.tile_url

      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, {
          type: 'raster',
          tiles: [tileUrl],
          tileSize: 256,
          attribution: layer.label,
          bounds: layer.bounds ?? undefined,
        })
      }
      if (!map.getLayer(layerId)) {
        map.addLayer({
          id: layerId,
          type: 'raster',
          source: sourceId,
          paint: {
            'raster-opacity': riskOpacity * 0.75,
            // Discrete class rasters must not bilinear-blur
            'raster-resampling': 'nearest',
          },
        }, beforeId)
      } else {
        map.setPaintProperty(layerId, 'raster-opacity', riskOpacity * 0.75)
      }
    })
  }, [mapReady, tileLayers, tileVisibility, riskOpacity])

  // ── Sync raster opacity when slider changes ───────────────────────────────
  useEffect(() => {
    if (!mapReady) return
    const map = mapObj.current
    tileLayers.forEach((layer) => {
      const layerId = `tiles-${layer.source}`
      if (map.getLayer(layerId)) {
        map.setPaintProperty(layerId, 'raster-opacity', riskOpacity * 0.75)
      }
    })
  }, [mapReady, riskOpacity, tileLayers])

  useEffect(() => {
    if (!mapReady) return
    const map = mapObj.current

    if (exposureData.roads) {
      if (map.getSource('exposure-roads')) {
        map.getSource('exposure-roads').setData(exposureData.roads)
      } else {
        map.addSource('exposure-roads', { type: 'geojson', data: exposureData.roads })
        addRoadLayers(map, 'exposure-roads')
      }
      ROAD_LAYER_STYLES.forEach(style => {
        const layerId = `exposure-roads-${style.key}`
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, 'visibility', exposureVisible.roads ? 'visible' : 'none')
        }
      })
    }

    if (exposureData.bridges) {
      if (map.getSource('exposure-bridges')) {
        map.getSource('exposure-bridges').setData(exposureData.bridges)
      } else {
        map.addSource('exposure-bridges', { type: 'geojson', data: exposureData.bridges })
        addBridgeLayer(map, 'exposure-bridges')
      }
      if (map.getLayer('exposure-bridges')) {
        map.setLayoutProperty('exposure-bridges', 'visibility', exposureVisible.bridges ? 'visible' : 'none')
      }
    }

    if (exposureData.places) {
      if (map.getSource('exposure-places')) {
        map.getSource('exposure-places').setData(exposureData.places)
      } else {
        map.addSource('exposure-places', { type: 'geojson', data: exposureData.places })
        addPlaceLayers(map, 'exposure-places')
      }
      PLACE_LAYER_STYLES.forEach(style => {
        const circleId = `exposure-places-${style.key}-circle`
        const labelId = `exposure-places-${style.key}-label`
        if (map.getLayer(circleId)) {
          map.setLayoutProperty(circleId, 'visibility', exposureVisible.places ? 'visible' : 'none')
        }
        if (map.getLayer(labelId)) {
          map.setLayoutProperty(labelId, 'visibility', exposureVisible.places ? 'visible' : 'none')
        }
      })
    }

    if (exposureData.buildings) {
      if (map.getSource('exposure-buildings')) {
        map.getSource('exposure-buildings').setData(exposureData.buildings)
      } else {
        map.addSource('exposure-buildings', { type: 'geojson', data: exposureData.buildings })
        addBuildingLayer(map, 'exposure-buildings')
      }
      if (map.getLayer('exposure-buildings')) {
        map.setLayoutProperty(
          'exposure-buildings',
          'visibility',
          exposureVisible.buildings ? 'visible' : 'none',
        )
      }
    }
  }, [mapReady, exposureData, exposureVisible])

  // ── Admin boundaries (states / LGAs) ───────────────────────────────────────
  useEffect(() => {
    if (!mapReady) return
    const map = mapObj.current

    ;['states', 'lgas'].forEach((layerKey) => {
      const data = boundaryData[layerKey]
      const sourceId = `admin-${layerKey}`
      if (!data) return

      if (map.getSource(sourceId)) {
        map.getSource(sourceId).setData(data)
      } else {
        map.addSource(sourceId, { type: 'geojson', data })
        addAdminBoundaryLayers(map, sourceId, layerKey)
      }

      const visibility = boundaryVisible[layerKey] ? 'visible' : 'none'
      ;[`admin-${layerKey}-fill`, `admin-${layerKey}-line`, `admin-${layerKey}-label`].forEach(
        (id) => {
          if (map.getLayer(id)) {
            map.setLayoutProperty(id, 'visibility', visibility)
          }
        },
      )
    })
  }, [mapReady, boundaryData, boundaryVisible])

  // ── Station markers ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady) return
    const map = mapObj.current

    // Clear existing station markers (keep place pin under __place)
    Object.keys(markersRef.current).forEach((key) => {
      if (key === '__place') return
      markersRef.current[key]?.remove()
      delete markersRef.current[key]
    })

    if (!gaugesVisible || !stations.length) return

    stations.forEach(s => {
      const reading = liveReadings[s.id]
      const risk  = reading?.risk_tier || 'Normal'
      const color = RISK_COLOR[risk]
      const pct   = reading ? Math.round((reading.water_level_m / s.bank_full_m) * 100) : 0

      const el = document.createElement('div')
      el.className = 'cursor-pointer'
      el.innerHTML = `
        <div style="
          width:18px;height:18px;border-radius:50%;
          background:${color};border:2.5px solid white;
          box-shadow:0 0 10px ${color},0 0 20px ${color}40;
          transition:transform .15s;
          ${selected === s.id ? 'transform:scale(1.6);outline:3px solid white;outline-offset:2px;' : ''}
        "></div>
      `
      el.addEventListener('click', () => {
        setSelectedRiskArea(null)
        onSelect(s.id)
      })
      el.addEventListener('mouseenter', () => { el.firstElementChild.style.transform = 'scale(1.4)' })
      el.addEventListener('mouseleave', () => {
        if (selected !== s.id) el.firstElementChild.style.transform = 'scale(1)'
      })

      const popup = new maplibregl.Popup({ offset: 18, closeButton: false, maxWidth: '200px' })
        .setHTML(`
          <div style="padding:10px 12px;font-size:12px;color:#e5e7eb;line-height:1.6">
            <div style="font-weight:600;font-size:13px;color:#f9fafb;margin-bottom:2px">${s.name}</div>
            <div style="color:#9ca3af;font-size:11px;margin-bottom:6px">${s.river} &middot; ${s.state}</div>
            <div style="display:flex;justify-content:space-between;margin-bottom:2px">
              <span style="color:#6b7280">Risk</span>
              <span style="font-weight:600;color:${color}">${risk}</span>
            </div>
            ${reading ? `
            <div style="display:flex;justify-content:space-between">
              <span style="color:#6b7280">Level</span>
              <span style="font-weight:500">${reading.water_level_m}m (${pct}%)</span>
            </div>` : `<div style="color:#6b7280;font-size:11px">No live data</div>`}
          </div>
        `)

      markersRef.current[s.id] = new maplibregl.Marker({ element: el })
        .setLngLat([s.lon, s.lat])
        .setPopup(popup)
        .addTo(map)
    })
  }, [mapReady, stations, liveReadings, selected, gaugesVisible, onSelect])

  // ── Fly-to on station select ───────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady || !selected) return
    const s = stations.find(st => st.id === selected)
    if (s) mapObj.current.flyTo({ center: [s.lon, s.lat], zoom: 9, duration: 1000 })
  }, [selected, mapReady])

  // ── Fly-to on search result ────────────────────────────────────────────────
  const handleSearchResult = useCallback((result) => {
    if (!mapObj.current) return
    if (result.bbox_lnglat) {
      const pad = publicMode
        ? { top: 80, right: 40, bottom: 280, left: 40 }
        : 60
      mapObj.current.fitBounds(
        [
          [result.bbox_lnglat[0], result.bbox_lnglat[1]],
          [result.bbox_lnglat[2], result.bbox_lnglat[3]],
        ],
        { padding: pad, duration: 1200, maxZoom: 11 },
      )
    } else {
      mapObj.current.flyTo({ center: [result.lon, result.lat], zoom: 10, duration: 1200 })
    }
    onPlaceSelect?.(result)
  }, [onPlaceSelect, publicMode])

  // External place focus (header search in public mode)
  useEffect(() => {
    if (!mapReady || !placeFocus || !mapObj.current) return
    if (placeFocus.bbox_lnglat?.length === 4) {
      mapObj.current.fitBounds(
        [
          [placeFocus.bbox_lnglat[0], placeFocus.bbox_lnglat[1]],
          [placeFocus.bbox_lnglat[2], placeFocus.bbox_lnglat[3]],
        ],
        {
          padding: publicMode
            ? { top: 80, right: 40, bottom: 280, left: 40 }
            : 60,
          duration: 1200,
          maxZoom: 11,
        },
      )
    } else {
      mapObj.current.flyTo({
        center: [placeFocus.lon, placeFocus.lat],
        zoom: 10,
        duration: 1200,
      })
    }
  }, [placeFocus, mapReady, publicMode])

  // Place pin marker
  useEffect(() => {
    if (!mapReady || !mapObj.current) return
    const map = mapObj.current
    const existing = markersRef.current.__place
    existing?.remove()
    delete markersRef.current.__place

    if (!placeFocus) return

    const el = document.createElement('div')
    el.innerHTML = `
      <div style="
        width:16px;height:16px;border-radius:50%;
        background:#0284c7;border:3px solid white;
        box-shadow:0 2px 12px rgba(2,132,199,.55);
      "></div>
    `
    markersRef.current.__place = new maplibregl.Marker({ element: el })
      .setLngLat([placeFocus.lon, placeFocus.lat])
      .addTo(map)
  }, [mapReady, placeFocus])

  // Highlight a road selected from the place panel
  useEffect(() => {
    if (!mapReady || !mapObj.current) return
    const map = mapObj.current

    const ensureLayers = () => {
      if (!map.getSource('road-highlight')) {
        map.addSource('road-highlight', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        })
      }
      if (!map.getLayer('road-highlight-glow')) {
        map.addLayer({
          id: 'road-highlight-glow',
          type: 'line',
          source: 'road-highlight',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#ffffff',
            'line-width': 12,
            'line-opacity': 0.85,
          },
        })
      }
      if (!map.getLayer('road-highlight-line')) {
        map.addLayer({
          id: 'road-highlight-line',
          type: 'line',
          source: 'road-highlight',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': ['get', 'color'],
            'line-width': 5,
            'line-opacity': 1,
          },
        })
      }
      if (!map.getLayer('road-highlight-point')) {
        map.addLayer({
          id: 'road-highlight-point',
          type: 'circle',
          source: 'road-highlight',
          filter: ['==', ['geometry-type'], 'Point'],
          paint: {
            'circle-radius': 8,
            'circle-color': ['get', 'color'],
            'circle-stroke-width': 3,
            'circle-stroke-color': '#ffffff',
          },
        })
      }
    }

    try {
      ensureLayers()
    } catch {
      return
    }

    const source = map.getSource('road-highlight')
    if (!source) return

    if (!roadHighlight) {
      source.setData({ type: 'FeatureCollection', features: [] })
      return
    }

    const color =
      SUSCEPTIBILITY_COLOR[roadHighlight.susceptibility] ||
      '#0284c7'
    const coords = roadHighlight.coordinates
    const hasLine = Array.isArray(coords) && coords.length >= 2

    const feature = hasLine
      ? {
          type: 'Feature',
          properties: {
            name: roadHighlight.name,
            color,
          },
          geometry: {
            type: 'LineString',
            coordinates: coords,
          },
        }
      : {
          type: 'Feature',
          properties: {
            name: roadHighlight.name,
            color,
          },
          geometry: {
            type: 'Point',
            coordinates: [roadHighlight.lon, roadHighlight.lat],
          },
        }

    source.setData({ type: 'FeatureCollection', features: [feature] })

    if (hasLine) {
      let minLon = Infinity
      let minLat = Infinity
      let maxLon = -Infinity
      let maxLat = -Infinity
      coords.forEach(([lon, lat]) => {
        if (lon < minLon) minLon = lon
        if (lat < minLat) minLat = lat
        if (lon > maxLon) maxLon = lon
        if (lat > maxLat) maxLat = lat
      })
      const pad = 0.01
      map.fitBounds(
        [
          [minLon - pad, minLat - pad],
          [maxLon + pad, maxLat + pad],
        ],
        {
          padding: publicMode
            ? { top: 80, right: 40, bottom: 300, left: 40 }
            : 80,
          duration: 900,
          maxZoom: 14,
        },
      )
    } else if (Number.isFinite(roadHighlight.lon) && Number.isFinite(roadHighlight.lat)) {
      map.flyTo({
        center: [roadHighlight.lon, roadHighlight.lat],
        zoom: 13,
        duration: 900,
      })
    }
  }, [mapReady, roadHighlight, publicMode])

  return (
    <div
      className={clsx(
        'relative h-full w-full',
        theme === 'dark' ? 'map-ui-dark' : 'map-ui-light',
      )}
    >
      {/* Map canvas — sibling/descendant MapLibre controls pick up .map-ui-* styles */}
      <div ref={mapRef} className="h-full w-full" />

      {/* Search bar — top centre (expert / optional) */}
      {showSearch && (
        <div className="absolute top-3 left-1/2 z-10 w-[min(20rem,calc(100%-1.5rem))] -translate-x-1/2">
          <SearchBar onResult={handleSearchResult} theme={theme} />
        </div>
      )}

      {/* Unified Layers panel — top left */}
      <div className="absolute top-3 left-3 z-10 space-y-2">
        <LayersPanel
          theme={theme}
          riskAreasVisible={riskAreasVisible}
          onToggleRiskAreas={() => setRiskAreasVisible((v) => !v)}
          riskOpacity={riskOpacity}
          onRiskOpacity={setRiskOpacity}
          urbanFlashVisible={urbanFlashVisible}
          onToggleUrbanFlash={() => setUrbanFlashVisible((v) => !v)}
          urbanFlashOpacity={urbanFlashOpacity}
          onUrbanFlashOpacity={setUrbanFlashOpacity}
          tileLayers={tileLayers}
          tileVisibility={tileVisibility}
          onToggleTile={toggleTileLayer}
          gaugesVisible={gaugesVisible}
          onToggleGauges={() => setGaugesVisible((v) => !v)}
          exposureLayers={exposureMeta.filter((layer) => layer.available)}
          exposureVisibility={exposureVisible}
          onToggleExposure={toggleExposureLayer}
          boundaryLayers={boundaryMeta.filter((layer) => layer.available)}
          boundaryVisibility={boundaryVisible}
          onToggleBoundary={toggleBoundaryLayer}
        />
        {exposureVisible.buildings && buildingsStatus && (
          <div
            className={clsx(
              'max-w-[14rem] rounded-lg border px-2.5 py-1.5 text-[10px] shadow',
              theme === 'dark'
                ? 'border-gray-700 bg-gray-900/90 text-gray-300'
                : 'border-slate-200 bg-white text-slate-600',
            )}
          >
            {buildingsStatus === 'loading' && 'Loading buildings for this view…'}
            {buildingsStatus === 'zoom' && 'Zoom in closer to load buildings.'}
            {buildingsStatus === 'error' && 'Could not load buildings (OSM).'}
            {buildingsStatus === 'ready' &&
              `${(exposureData.buildings?.features || []).length.toLocaleString()} buildings in view`}
          </div>
        )}
      </div>

      {/* Home + basemap — below zoom (+/−) only; fullscreen is bottom-right */}
      <div className="absolute top-[5.5rem] right-3 z-10 flex flex-col gap-2">
        <button
          type="button"
          onClick={resetToHomeView}
          className={clsx(
            'inline-flex h-10 w-10 items-center justify-center rounded-xl border shadow-lg transition',
            theme === 'dark'
              ? 'border-gray-700 bg-gray-900 text-gray-200 hover:border-gray-500 hover:bg-gray-800 hover:text-white'
              : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
          )}
          style={
            theme === 'dark'
              ? { backgroundColor: '#111827', borderColor: '#374151' }
              : { backgroundColor: '#ffffff', borderColor: '#cbd5e1' }
          }
          aria-label="Reset map to Nigeria view"
          title="Home"
        >
          <IconHome size={16} />
        </button>
        <BasemapSwitcher
          current={basemap}
          onChange={onBasemapChange}
          options={BASEMAPS}
          theme={theme}
        />
      </div>

      {/* Legend — symbology only */}
      <div className="absolute bottom-10 left-3 z-10 hidden sm:block">
        <FloodRiskLegend
          showProbability={riskAreasVisible}
          showUrbanFlash={urbanFlashVisible}
          showHistory={Boolean(tileVisibility.jrc_occurrence)}
          historyLegend={
            tileLayers.find((l) => l.source === 'jrc_occurrence')?.legend ?? null
          }
          susceptibilityLegend={
            tileVisibility.gee_susceptibility_classes
              ? (tileLayers.find((l) => l.source === 'gee_susceptibility_classes')?.legend ?? null)
              : null
          }
          visibleExposureIds={Object.keys(exposureVisible).filter((id) => exposureVisible[id])}
          visibleBoundaryIds={Object.keys(boundaryVisible).filter((id) => boundaryVisible[id])}
          showGauges={gaugesVisible}
          theme={theme}
        />
      </div>

      {/* Impact summary — expert only */}
      {!publicMode && impactSummary && (
        <div className="absolute bottom-3 left-64 right-3 z-10 hidden md:block">
          <ImpactSummaryPanel summary={impactSummary} theme={theme} />
        </div>
      )}
    </div>
  )
}
