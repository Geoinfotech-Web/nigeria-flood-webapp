import React, { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import clsx from 'clsx'
import SearchBar from './SearchBar'
import BasemapSwitcher from './BasemapSwitcher'
import FloodRiskLegend from './FloodRiskLegend'
import LayersPanel from './LayersPanel'
import FloodNewsLayer from './FloodNewsLayer'
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
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
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
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
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
  {
    id:    'google',
    label: 'Google',
    // Resolved at map init from /map/google-style (proxied Map Tiles)
    styleUrl: 'google-style',
  },
  {
    id:    'google-sat',
    label: 'Google Sat',
    styleUrl: 'google-style-sat',
  },
]

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

async function resolveBasemapStyle(basemapId) {
  const def = BASEMAPS.find((b) => b.id === basemapId)
  if (!def) return BASEMAPS.find((b) => b.id === 'streets')?.style
  if (def.style) return def.style
  if (def.styleUrl === 'google-style') {
    const r = await fetch(`${API}/map/google-style?map_type=roadmap`)
    if (!r.ok) throw new Error('Google basemap unavailable')
    return r.json()
  }
  if (def.styleUrl === 'google-style-sat') {
    const r = await fetch(`${API}/map/google-style?map_type=satellite`)
    if (!r.ok) throw new Error('Google satellite basemap unavailable')
    return r.json()
  }
  return def.style
}
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

/** Zoom the map to a place: tight flyTo, or fitBounds only for small local bboxes. */
function focusMapOnPlace(map, place, { publicMode = false, zoom = 13 } = {}) {
  if (!map || !place) return
  const lat = Number(place.lat)
  const lon = Number(place.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return

  const bbox = place.bbox_lnglat
  let useBbox = false
  if (Array.isArray(bbox) && bbox.length === 4) {
    const [west, south, east, north] = bbox.map(Number)
    if ([west, south, east, north].every(Number.isFinite)) {
      const span = Math.max(Math.abs(east - west), Math.abs(north - south))
      // Ignore huge state/country boxes from geocoders — they barely zoom in.
      useBbox = span > 0.002 && span < 0.6
    }
  }

  if (useBbox) {
    map.fitBounds(
      [
        [bbox[0], bbox[1]],
        [bbox[2], bbox[3]],
      ],
      {
        padding: publicMode
          ? { top: 80, right: 40, bottom: 280, left: 40 }
          : { top: 60, right: 60, bottom: 60, left: 60 },
        duration: 1200,
        maxZoom: 14,
      },
    )
    return
  }

  map.flyTo({
    center: [lon, lat],
    zoom,
    duration: 1200,
  })
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
  const isBasin = layerKey === 'basins'
  const lineColor = isBasin ? '#0369a1' : isState ? '#0f766e' : '#64748b'
  const fillColor = isBasin ? '#0ea5e9' : isState ? '#14b8a6' : '#94a3b8'
  const minzoom = isBasin ? 4 : isState ? 4 : 7
  const labelMinzoom = isBasin ? 7 : isState ? 5 : 9
  const levelLabel = isBasin ? 'River basin' : isState ? 'State' : 'LGA'

  if (!map.getLayer(fillId)) {
    map.addLayer({
      id: fillId,
      type: 'fill',
      source: sourceId,
      minzoom,
      paint: {
        'fill-color': fillColor,
        'fill-opacity': isBasin ? 0.05 : 0.06,
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
        'line-width': isBasin
          ? ['interpolate', ['linear'], ['zoom'], 4, 0.7, 8, 1.4, 12, 2]
          : isState
            ? ['interpolate', ['linear'], ['zoom'], 4, 1.2, 8, 2.2, 12, 2.8]
            : ['interpolate', ['linear'], ['zoom'], 7, 0.6, 10, 1.2, 13, 1.8],
        'line-opacity': isBasin ? 0.75 : 0.85,
      },
    })
  }
  if (!isBasin && !map.getLayer(labelId)) {
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
      const areaBit = props.area_km2
        ? `<div style="display:flex;justify-content:space-between"><span style="color:#6b7280">Area</span><span>${Number(props.area_km2).toLocaleString()} km²</span></div>`
        : ''
      new maplibregl.Popup({ closeButton: false, maxWidth: '220px' })
        .setLngLat(e.lngLat)
        .setHTML(`
          <div style="padding:10px 12px;font-size:12px;color:#e5e7eb;line-height:1.6">
            <div style="font-weight:600;font-size:13px;color:#f9fafb;margin-bottom:4px">${props.name || 'Boundary'}</div>
            <div style="display:flex;justify-content:space-between;margin-bottom:2px">
              <span style="color:#6b7280">Level</span>
              <span>${levelLabel}</span>
            </div>
            ${props.state && !isState && !isBasin ? `<div style="display:flex;justify-content:space-between"><span style="color:#6b7280">State</span><span>${props.state}</span></div>` : ''}
            ${areaBit}
          </div>
        `)
        .addTo(map)
    })
    registerPointerCursor(map, fillId)
  }
}

function ensureSelectedBasinLayers(map) {
  const sourceId = 'basin-selected'
  if (!map.getSource(sourceId)) {
    map.addSource(sourceId, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
  }
  if (!map.getLayer('basin-selected-fill')) {
    map.addLayer({
      id: 'basin-selected-fill',
      type: 'fill',
      source: sourceId,
      paint: {
        'fill-color': '#0284c7',
        'fill-opacity': 0.14,
      },
    })
  }
  if (!map.getLayer('basin-selected-line')) {
    map.addLayer({
      id: 'basin-selected-line',
      type: 'line',
      source: sourceId,
      paint: {
        'line-color': '#0369a1',
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.8, 8, 2.8, 12, 3.6],
        'line-opacity': 0.95,
      },
    })
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

function addPlaceLayers(map, sourceId, onPlaceClick) {
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
        const feature = e.features?.[0]
        const props = feature?.properties || {}
        const coords = feature?.geometry?.coordinates
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
        if (onPlaceClick && Array.isArray(coords) && coords.length >= 2) {
          onPlaceClick({
            name: props.name || 'Place',
            display_name: props.display_name || `${props.name || 'Place'}, Nigeria`,
            lat: Number(coords[1]),
            lon: Number(coords[0]),
            bbox_lnglat: null,
            class: props.class || style.className,
            population: props.population ?? null,
          })
        }
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

function showCommunityReportPopup(map, report, theme) {
  const body = document.createElement('article')
  body.className = 'community-report-popup-body'

  if (report.media_url) {
    const mediaUrl = report.media_url.startsWith('http') ? report.media_url : `${API}${report.media_url}`
    const media = document.createElement(report.media_type === 'video' ? 'video' : 'img')
    media.src = mediaUrl
    media.className = 'community-report-popup-media'
    if (report.media_type === 'video') {
      media.controls = true
      media.preload = 'metadata'
    } else {
      media.alt = `Flood report from ${report.location_name}`
    }
    body.append(media)
  }

  const header = document.createElement('header')
  header.className = 'community-report-popup-header'
  const headingWrap = document.createElement('div')
  const eyebrow = document.createElement('span')
  eyebrow.className = 'community-report-popup-eyebrow'
  eyebrow.textContent = 'Community flood incident'
  const heading = document.createElement('strong')
  heading.textContent = report.location_name
  headingWrap.append(eyebrow, heading)
  const badge = document.createElement('span')
  badge.className = `community-report-popup-badge ${report.status === 'verified' ? 'is-verified' : ''}`
  badge.textContent = report.status === 'verified' ? 'Verified' : `${report.verification_count || 0}/2 confirmed`
  header.append(headingWrap, badge)

  const summary = document.createElement('p')
  summary.className = 'community-report-popup-meta'
  summary.textContent = `${report.incident_type} · ${report.severity}`
  body.append(header, summary)

  const details = [
    report.affected_street && ['Affected street', report.affected_street],
    report.flood_source && ['Flood source', report.flood_source],
    report.water_depth_cm != null && ['Estimated depth', `${report.water_depth_cm} cm`],
  ].filter(Boolean)
  if (details.length) {
    const grid = document.createElement('dl')
    grid.className = 'community-report-popup-details'
    details.forEach(([label, value]) => {
      const item = document.createElement('div')
      const term = document.createElement('dt')
      term.textContent = label
      const description = document.createElement('dd')
      description.textContent = value
      item.append(term, description)
      grid.append(item)
    })
    body.append(grid)
  }

  const description = document.createElement('p')
  description.className = 'community-report-popup-description'
  description.textContent = report.description
  body.append(description)

  return new maplibregl.Popup({
    offset: 20,
    maxWidth: '270px',
    closeButton: true,
    className: `community-report-popup ${theme === 'dark' ? 'is-dark' : 'is-light'}`,
  })
    .setLngLat([report.longitude, report.latitude])
    .setDOMContent(body)
    .addTo(map)
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
  zoneFocus = null,
  communityReportFocus = null,
  roadHighlight = null,
  forceBuildingsLayer = false,
  onBuildingsViewportChange = null,
  onPlaceSelect,
  showSearch = true,
  navigation = null,
  highlightSelectedBasin = false,
}) {
  const publicMode = variant === 'public'
  const mapRef     = useRef(null)
  const mapObj     = useRef(null)
  const markersRef = useRef({})
  const newsArticlesRef = useRef([])
  const communityReportsRef = useRef([])
  const [riskAreasVisible, setRiskAreasVisible] = useState(true)
  const [urbanFlashVisible, setUrbanFlashVisible] = useState(true)
  const [urbanFlashOpacity, setUrbanFlashOpacity] = useState(0.6)
  const [gaugesVisible, setGaugesVisible] = useState(true)
  const [newsVisible, setNewsVisible] = useState(false)
  const [newsArticles, setNewsArticles] = useState([])
  const [communityReports, setCommunityReports] = useState([])
  const [riskOpacity, setRiskOpacity] = useState(0.6)
  const [riskData,    setRiskData]    = useState(null)
  const [urbanFlashData, setUrbanFlashData] = useState(null)
  const [mapReady,    setMapReady]    = useState(false)
  /** Bumped after each basemap setStyle so overlays re-attach (setStyle wipes sources). */
  const [styleEpoch,  setStyleEpoch]  = useState(0)
  const [tileLayers,  setTileLayers]  = useState([])
  /** Independent raster toggles keyed by layer source, e.g. jrc_occurrence */
  const [tileVisibility, setTileVisibility] = useState({})

  useEffect(() => {
    if (!publicMode) setNewsVisible(false)
  }, [publicMode])
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
  const [boundaryData, setBoundaryData] = useState({ states: null, lgas: null, basins: null })
  const [boundaryVisible, setBoundaryVisible] = useState({ states: false, lgas: false, basins: false })
  const [buildingsStatus, setBuildingsStatus] = useState(null) // loading | ready | zoom | error
  const buildingsFetchRef = useRef(0)
  const appliedBasemapRef = useRef(null)
  const onPlaceSelectRef = useRef(onPlaceSelect)
  useEffect(() => {
    onPlaceSelectRef.current = onPlaceSelect
  }, [onPlaceSelect])

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
  const receiveNewsArticles = useCallback((articles) => {
    newsArticlesRef.current = articles
    setNewsArticles(articles)
  }, [])

  const loadCommunityReports = useCallback(async () => {
    try {
      const response = await fetch(`${API}/incidents?limit=100`, { cache: 'no-store' })
      if (!response.ok) return
      const reports = await response.json()
      communityReportsRef.current = reports
      setCommunityReports(reports)
    } catch (_) { /* Keep the map usable while reports reconnect. */ }
  }, [])

  useEffect(() => {
    loadCommunityReports()
    const timer = setInterval(loadCommunityReports, 20000)
    window.addEventListener('flood-reports-changed', loadCommunityReports)
    return () => {
      clearInterval(timer)
      window.removeEventListener('flood-reports-changed', loadCommunityReports)
    }
  }, [loadCommunityReports])
  const focusNewsArticle = useCallback((article) => {
    const map = mapObj.current
    if (!map) return
    if (!Number.isFinite(article.lat) || !Number.isFinite(article.lon)) {
      window.open(article.url, '_blank', 'noopener,noreferrer')
      return
    }
    map.flyTo({ center: [article.lon, article.lat], zoom: 10.5, duration: 1300 })
    const content = document.createElement('div')
    content.className = 'flood-news-popup-body'
    if (article.image_url) {
      const image = document.createElement('img')
      image.src = article.image_url
      image.alt = `${article.source} report`
      image.referrerPolicy = 'no-referrer'
      image.className = `flood-news-popup-image ${article.image_kind === 'report' ? '' : 'is-source'}`
      content.append(image)
    }
    const heading = document.createElement('strong')
    heading.textContent = article.location || 'Flood report'
    const title = document.createElement('p')
    title.textContent = article.title
    title.style.margin = '6px 0'
    const link = document.createElement('a')
    link.href = article.url
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.textContent = `Open report · ${article.source}`
    content.append(heading, title, link)
    new maplibregl.Popup({ offset: 16, maxWidth: '320px', className: `flood-news-popup ${theme === 'dark' ? 'is-dark' : 'is-light'}` }).setLngLat([article.lon, article.lat]).setDOMContent(content).addTo(map)
  }, [theme])

  useEffect(() => {
    if (!mapReady || !mapObj.current) return
    const map = mapObj.current
    const data = { type: 'FeatureCollection', features: newsArticles.map((a, index) => Number.isFinite(a.lat) && Number.isFinite(a.lon) ? ({ type: 'Feature', id: index, properties: { index }, geometry: { type: 'Point', coordinates: [a.lon, a.lat] } }) : null).filter(Boolean) }
    if (map.getSource('flood-news')) map.getSource('flood-news').setData(data)
    else {
      map.addSource('flood-news', { type: 'geojson', data })
      map.addLayer({ id: 'flood-news-points', type: 'circle', source: 'flood-news', paint: { 'circle-radius': 8, 'circle-color': '#ef4444', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2, 'circle-opacity': 0.9 } })
      map.on('mouseenter', 'flood-news-points', () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', 'flood-news-points', () => { map.getCanvas().style.cursor = '' })
      map.on('click', 'flood-news-points', (event) => {
        const index = Number(event.features?.[0]?.properties?.index)
        const article = newsArticlesRef.current[index]
        if (article) focusNewsArticle(article)
      })
    }
    map.setLayoutProperty('flood-news-points', 'visibility', newsVisible ? 'visible' : 'none')
  }, [mapReady, styleEpoch, newsArticles, newsVisible])

  useEffect(() => {
    if (!mapReady || !mapObj.current) return
    const map = mapObj.current
    const features = communityReports.map((report, index) => (
      Number.isFinite(report.latitude) && Number.isFinite(report.longitude)
        ? { type: 'Feature', id: report.id, properties: { index, severity: report.severity, status: report.status }, geometry: { type: 'Point', coordinates: [report.longitude, report.latitude] } }
        : null
    )).filter(Boolean)
    const data = { type: 'FeatureCollection', features }
    if (map.getSource('community-flood-reports')) map.getSource('community-flood-reports').setData(data)
    else {
      map.addSource('community-flood-reports', { type: 'geojson', data })
      map.addLayer({
        id: 'community-flood-report-points',
        type: 'circle',
        source: 'community-flood-reports',
        paint: {
          'circle-radius': 9,
          'circle-color': ['match', ['get', 'severity'], 'Critical', '#dc2626', 'High', '#f97316', 'Moderate', '#facc15', '#10b981'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2.5,
          'circle-opacity': 0.95,
        },
      })
      map.on('mouseenter', 'community-flood-report-points', () => { map.getCanvas().style.cursor = 'pointer' })
      map.on('mouseleave', 'community-flood-report-points', () => { map.getCanvas().style.cursor = '' })
      map.on('click', 'community-flood-report-points', (event) => {
        const index = Number(event.features?.[0]?.properties?.index)
        const report = communityReportsRef.current[index]
        if (!report) return
        showCommunityReportPopup(map, report, theme)
      })
    }
  }, [mapReady, styleEpoch, communityReports, theme])

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
  }, [mapReady, styleEpoch, navigation])

  // ── Init map once (Streets). Basemap changes use setStyle below. ───────────
  useEffect(() => {
    if (!mapRef.current) return

    let cancelled = false
    const streetsStyle = BASEMAPS.find((b) => b.id === 'streets')?.style
    const map = new maplibregl.Map({
      container: mapRef.current,
      style: streetsStyle,
      center: [8.0, 9.0],
      zoom: 5.5,
      minZoom: 4,
    })
    mapObj.current = map
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      'top-right',
    )
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
    map.addControl(new maplibregl.FullscreenControl(), 'bottom-right')
    map.on('load', () => {
      if (!cancelled) setMapReady(true)
    })
    map.on('error', (e) => {
      console.warn('MapLibre error', e?.error || e)
    })

    return () => {
      cancelled = true
      mapObj.current?.remove()
      mapObj.current = null
      appliedBasemapRef.current = null
      setMapReady(false)
    }
  }, [])

  // Swap basemap via setStyle. Never flip mapReady off here — that cancelled the
  // style.load handler (effect cleanup) and left the map stuck until refresh.
  useEffect(() => {
    const map = mapObj.current
    if (!map || !mapReady) return
    if (appliedBasemapRef.current === basemap) return

    let cancelled = false

    async function applyBasemap() {
      if (appliedBasemapRef.current === null && basemap === 'streets') {
        appliedBasemapRef.current = 'streets'
        return
      }

      let style
      try {
        style = await resolveBasemapStyle(basemap)
      } catch (err) {
        console.warn(err)
        try {
          style = await resolveBasemapStyle('streets')
        } catch (err2) {
          console.warn(err2)
          return
        }
      }
      if (cancelled || !mapObj.current) return

      const target = basemap
      await new Promise((resolve) => {
        let settled = false
        const finish = () => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          mapObj.current?.off('style.load', onLoad)
          resolve()
        }
        const onLoad = () => finish()
        const timer = setTimeout(finish, 10000)
        mapObj.current.once('style.load', onLoad)
        try {
          mapObj.current.setStyle(style, { diff: false })
        } catch (err) {
          console.warn('Failed to set basemap style', err)
          finish()
        }
      })

      if (cancelled || !mapObj.current) return
      appliedBasemapRef.current = target
      // Re-run overlay effects — setStyle removes all custom sources/layers
      setStyleEpoch((n) => n + 1)
    }

    applyBasemap()
    return () => { cancelled = true }
  }, [basemap, mapReady])

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
        // Public keeps Inundation History on by default; Expert starts with only
        // gauges + urban flash visible to reduce map clutter.
        setTileVisibility((current) => {
          const next = { ...current }
          layers.forEach((layer) => {
            if (next[layer.source] === undefined) {
              next[layer.source] = publicMode ? layer.source === 'jrc_occurrence' : false
            }
          })
          return next
        })
      })
      .catch(console.error)
  }, [publicMode])

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

  // Prefetch basins when highlight is requested for the selected gauge
  useEffect(() => {
    if (!highlightSelectedBasin || !selected || boundaryData.basins) return
    const station = stations.find((st) => st.id === selected)
    if (!station?.basin_id) return
    fetch(`${API}/boundaries/basins`)
      .then((r) => r.json())
      .then((data) => {
        setBoundaryData((current) => {
          if (current.basins) return current
          return { ...current, basins: data }
        })
      })
      .catch(console.error)
  }, [highlightSelectedBasin, selected, stations, boundaryData.basins])

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
  }, [mapReady, styleEpoch, exposureVisible.buildings, onBuildingsViewportChange])

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
  }, [mapReady, styleEpoch, riskData])

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
  }, [mapReady, styleEpoch, riskAreasVisible, riskOpacity])

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
  }, [mapReady, styleEpoch, urbanFlashData])

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
  }, [mapReady, styleEpoch, urbanFlashVisible, urbanFlashOpacity])

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
  }, [mapReady, styleEpoch, tileLayers, tileVisibility, riskOpacity])

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
  }, [mapReady, styleEpoch, riskOpacity, tileLayers])

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
        addPlaceLayers(map, 'exposure-places', (nextPlace) => {
          onPlaceSelectRef.current?.(nextPlace)
        })
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
  }, [mapReady, styleEpoch, exposureData, exposureVisible])

  // ── Admin / basin boundaries ───────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady) return
    const map = mapObj.current

    ;['states', 'lgas', 'basins'].forEach((layerKey) => {
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
  }, [mapReady, styleEpoch, boundaryData, boundaryVisible])

  // ── Highlight selected gauge's HydroBASINS catchment ───────────────────────
  useEffect(() => {
    if (!mapReady) return
    const map = mapObj.current
    ensureSelectedBasinLayers(map)
    const source = map.getSource('basin-selected')
    if (!source) return

    const empty = { type: 'FeatureCollection', features: [] }
    if (!highlightSelectedBasin || !selected || !boundaryData.basins) {
      source.setData(empty)
      return
    }
    const station = stations.find((st) => st.id === selected)
    const basinId = station?.basin_id
    if (!basinId) {
      source.setData(empty)
      return
    }
    const match = (boundaryData.basins.features || []).find(
      (f) => Number(f.properties?.basin_id) === Number(basinId),
    )
    source.setData(
      match
        ? { type: 'FeatureCollection', features: [match] }
        : empty,
    )
  }, [mapReady, styleEpoch, highlightSelectedBasin, selected, stations, boundaryData.basins])

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
  }, [mapReady, styleEpoch, stations, liveReadings, selected, gaugesVisible, onSelect])

  // ── Fly-to on station select ───────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady || !selected) return
    const s = stations.find(st => st.id === selected)
    if (s) mapObj.current.flyTo({ center: [s.lon, s.lat], zoom: 9, duration: 1000 })
  }, [selected, mapReady, styleEpoch])

  // ── Fly-to on search result ────────────────────────────────────────────────
  const handleSearchResult = useCallback((result) => {
    if (!mapObj.current) return
    focusMapOnPlace(mapObj.current, result, { publicMode, zoom: 13 })
    onPlaceSelect?.(result)
  }, [onPlaceSelect, publicMode])

  // External place focus (header search, at-risk list, nearby settlements, …)
  useEffect(() => {
    if (!mapReady || !placeFocus || !mapObj.current) return
    focusMapOnPlace(mapObj.current, placeFocus, { publicMode, zoom: 13 })
  }, [placeFocus, mapReady, styleEpoch, publicMode])

  useEffect(() => {
    if (!mapReady || !zoneFocus || !mapObj.current) return
    if (zoneFocus.bbox_lnglat?.length === 4) {
      mapObj.current.fitBounds(
        [
          [zoneFocus.bbox_lnglat[0], zoneFocus.bbox_lnglat[1]],
          [zoneFocus.bbox_lnglat[2], zoneFocus.bbox_lnglat[3]],
        ],
        {
          padding: publicMode
            ? { top: 80, right: 40, bottom: 280, left: 40 }
            : 80,
          duration: 1200,
          maxZoom: 11,
        },
      )
    } else if (Number.isFinite(zoneFocus.lon) && Number.isFinite(zoneFocus.lat)) {
      mapObj.current.flyTo({
        center: [zoneFocus.lon, zoneFocus.lat],
        zoom: 10,
        duration: 1200,
      })
    }
  }, [zoneFocus, mapReady, styleEpoch, publicMode])

  useEffect(() => {
    if (!mapReady || !communityReportFocus || !mapObj.current) return
    if (!Number.isFinite(communityReportFocus.latitude) || !Number.isFinite(communityReportFocus.longitude)) return
    const map = mapObj.current
    let popup = null
    const revealReport = () => {
      popup = showCommunityReportPopup(map, communityReportFocus, theme)
    }
    map.once('moveend', revealReport)
    map.flyTo({
      center: [communityReportFocus.longitude, communityReportFocus.latitude],
      zoom: Math.max(map.getZoom(), 13.5),
      offset: [0, 105],
      duration: 1200,
      essential: true,
    })
    return () => {
      map.off('moveend', revealReport)
      popup?.remove()
    }
  }, [communityReportFocus, mapReady, theme])

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
  }, [mapReady, styleEpoch, placeFocus])

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
  }, [mapReady, styleEpoch, roadHighlight, publicMode])

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
          newsVisible={newsVisible}
          onToggleNews={() => setNewsVisible((v) => !v)}
          showNewsControl={publicMode}
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
      {newsVisible && <FloodNewsLayer theme={theme} onClose={() => setNewsVisible(false)} onArticles={receiveNewsArticles} onFocus={focusNewsArticle} />}

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
          collapsedByDefault={!publicMode}
        />
      </div>
    </div>
  )
}
