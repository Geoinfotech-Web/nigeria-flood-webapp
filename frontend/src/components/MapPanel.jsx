import React, { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl from 'maplibre-gl'
import SearchBar from './SearchBar'
import BasemapSwitcher from './BasemapSwitcher'
import FloodRiskLegend from './FloodRiskLegend'
import RiskLayerControl from './RiskLayerControl'

const RISK_COLOR = {
  Normal:    '#22c55e',
  Watch:     '#eab308',
  Warning:   '#f97316',
  Emergency: '#ef4444',
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

export default function MapPanel({ stations, liveReadings, selected, onSelect }) {
  const mapRef     = useRef(null)
  const mapObj     = useRef(null)
  const markersRef = useRef({})
  const [basemap,     setBasemap]     = useState('dark')
  const [riskVisible, setRiskVisible] = useState(true)
  const [riskOpacity, setRiskOpacity] = useState(0.6)
  const [riskData,    setRiskData]    = useState(null)
  const [mapReady,    setMapReady]    = useState(false)
  const [tileLayers,  setTileLayers]  = useState([])
  const [activeTile,  setActiveTile]  = useState(null)  // layer id string or null

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
    mapObj.current.addControl(new maplibregl.NavigationControl(), 'top-right')
    mapObj.current.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
    mapObj.current.addControl(new maplibregl.FullscreenControl(), 'top-right')

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

  // ── Load available raster tile layers ─────────────────────────────────────
  useEffect(() => {
    fetch(`${API}/flood-risk/layers`)
      .then(r => r.json())
      .then(layers => {
        setTileLayers(layers)
        // Auto-select the GEE susceptibility layer if present, else JRC
        const gee = layers.find(l => l.source === 'gee_jrc')
        setActiveTile(gee ? String(gee.id) : (layers[0] ? String(layers[0].id) : null))
      })
      .catch(console.error)
  }, [])

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
            'Emergency', '#ef4444',
            'Warning',   '#f97316',
            'Watch',     '#eab308',
            '#22c55e',
          ],
          'fill-opacity': riskOpacity * 0.6,
        },
      }, firstSymbol)

      map.addLayer({
        id:     'flood-risk-outline',
        type:   'line',
        source: 'flood-risk',
        paint: {
          'line-color': [
            'match', ['get', 'risk_tier'],
            'Emergency', '#ef4444',
            'Warning',   '#f97316',
            'Watch',     '#eab308',
            '#22c55e',
          ],
          'line-width': 1.2,
          'line-opacity': riskOpacity,
        },
      }, firstSymbol)

      // Click on risk area → popup
      map.on('click', 'flood-risk-fill', e => {
        const p = e.features[0].properties
        new maplibregl.Popup({ closeButton: false, maxWidth: '220px' })
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="padding:10px 12px;font-size:12px;color:#e5e7eb;line-height:1.6">
              <div style="font-weight:600;font-size:13px;color:#f9fafb;margin-bottom:4px">${p.name}</div>
              <div style="color:#9ca3af;font-size:11px;margin-bottom:6px;text-transform:capitalize">${p.admin_level}</div>
              <div style="display:flex;justify-content:space-between;margin-bottom:2px">
                <span style="color:#6b7280">Risk</span>
                <span style="font-weight:600;color:${RISK_COLOR[p.risk_tier]}">${p.risk_tier}</span>
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
    const vis = riskVisible ? 'visible' : 'none'
    map.setLayoutProperty('flood-risk-fill',    'visibility', vis)
    map.setLayoutProperty('flood-risk-outline', 'visibility', vis)
    map.setPaintProperty('flood-risk-fill',    'fill-opacity',  riskOpacity * 0.6)
    map.setPaintProperty('flood-risk-outline', 'line-opacity',  riskOpacity)
  }, [mapReady, riskVisible, riskOpacity])

  // ── Add / swap GEE raster tile layer ──────────────────────────────────────
  useEffect(() => {
    if (!mapReady) return
    const map = mapObj.current

    // Remove old tile layer if present
    if (map.getLayer('gee-tiles')) map.removeLayer('gee-tiles')
    if (map.getSource('gee-tiles')) map.removeSource('gee-tiles')

    if (!activeTile || !riskVisible) return

    const layer = tileLayers.find(l => String(l.id) === activeTile)
    if (!layer) return

    // Replace {z}/{x}/{y} placeholders with MapLibre tokens
    const tileUrl = layer.tile_url
      .replace('{z}', '{z}')
      .replace('{x}', '{x}')
      .replace('{y}', '{y}')

    map.addSource('gee-tiles', {
      type: 'raster',
      tiles: [tileUrl],
      tileSize: 256,
      attribution: layer.label,
    })

    // Insert below flood-risk-fill so polygons are still clickable on top
    map.addLayer({
      id:     'gee-tiles',
      type:   'raster',
      source: 'gee-tiles',
      paint:  { 'raster-opacity': riskOpacity * 0.75 },
    }, map.getLayer('flood-risk-fill') ? 'flood-risk-fill' : undefined)
  }, [mapReady, activeTile, riskVisible, tileLayers])

  // ── Sync GEE tile opacity when slider changes ─────────────────────────────
  useEffect(() => {
    if (!mapReady) return
    const map = mapObj.current
    if (map.getLayer('gee-tiles')) {
      map.setPaintProperty('gee-tiles', 'raster-opacity', riskOpacity * 0.75)
    }
  }, [mapReady, riskOpacity])

  // ── Station markers ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapReady || !stations.length) return
    const map = mapObj.current

    stations.forEach(s => {
      const reading = liveReadings[s.id]
      const risk  = reading?.risk_tier || 'Normal'
      const color = RISK_COLOR[risk]
      const pct   = reading ? Math.round((reading.water_level_m / s.bank_full_m) * 100) : 0

      markersRef.current[s.id]?.remove()

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
      el.addEventListener('click', () => onSelect(s.id))
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
  }, [mapReady, stations, liveReadings, selected])

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
      mapObj.current.fitBounds(result.bbox_lnglat, { padding: 60, duration: 1200 })
    } else {
      mapObj.current.flyTo({ center: [result.lon, result.lat], zoom: 12, duration: 1200 })
    }
  }, [])

  return (
    <div className="relative w-full h-full">
      {/* Map canvas */}
      <div ref={mapRef} className="w-full h-full" />

      {/* Search bar — top centre */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 w-80">
        <SearchBar onResult={handleSearchResult} />
      </div>

      {/* Basemap switcher — bottom right */}
      <div className="absolute bottom-10 right-3 z-10">
        <BasemapSwitcher current={basemap} onChange={setBasemap} />
      </div>

      {/* Risk layer control — top left */}
      <div className="absolute top-3 left-3 z-10">
        <RiskLayerControl
          visible={riskVisible}
          opacity={riskOpacity}
          onToggle={() => setRiskVisible(v => !v)}
          onOpacity={setRiskOpacity}
          tileLayers={tileLayers}
          activeTile={activeTile}
          onTileLayer={setActiveTile}
        />
      </div>

      {/* Legend — bottom left (above scale) */}
      <div className="absolute bottom-10 left-3 z-10">
        <FloodRiskLegend />
      </div>
    </div>
  )
}
