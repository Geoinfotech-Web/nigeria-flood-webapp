import { useEffect, useState } from 'react'
import axios from 'axios'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

function featuresToList(features = []) {
  return features.slice(0, 40).map((f) => {
    const props = f.properties || {}
    const [lon, lat] = f.geometry?.coordinates || []
    return {
      osm_id: props.osm_id,
      osm_type: props.osm_type,
      name: props.name || props.class || 'Building',
      class: props.class || 'Building',
      building: props.building,
      levels: props.levels,
      lat,
      lon,
      distance_km: props.distance_km ?? null,
      zone_tier: props.zone_tier ?? null,
      exposed: Boolean(props.exposed || props.zone_tier),
    }
  })
}

/**
 * Buildings near a place, with flood-zone exposure counts.
 * Falls back to viewport-style bbox fetch (same as map layer) if the
 * combined nearby+zone endpoint fails — so the tab still gets a list.
 */
export function useNearbyBuildings(place, { radiusKm = 3, minTier = 'Moderate' } = {}) {
  const [buildings, setBuildings] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!place?.lat || !place?.lon) {
      setBuildings([])
      setSummary(null)
      setError(null)
      return
    }

    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const { data } = await axios.get(`${API}/exposure/nearby-buildings`, {
          params: {
            lat: place.lat,
            lon: place.lon,
            radius_km: radiusKm,
            min_tier: minTier,
            list_limit: 40,
          },
          timeout: 90000,
        })
        if (!cancelled) {
          setBuildings(Array.isArray(data?.buildings) ? data.buildings : [])
          setSummary(data?.summary || null)
        }
      } catch (primaryErr) {
        // Same OSM source as the map Buildings layer — keeps the tab usable
        try {
          const pad = Math.max(radiusKm / 111, 0.015)
          const { data } = await axios.get(`${API}/exposure/buildings`, {
            params: {
              west: place.lon - pad,
              south: place.lat - pad,
              east: place.lon + pad,
              north: place.lat + pad,
              limit: 1500,
            },
            timeout: 90000,
          })
          if (cancelled) return
          const list = featuresToList(data?.features || [])
          setBuildings(list)
          setSummary({
            total_in_radius: data?.meta?.count ?? list.length,
            exposed_in_flood_zones: 0,
            listed: list.length,
            by_zone_tier: {},
            by_class: list.reduce((acc, b) => {
              acc[b.class] = (acc[b.class] || 0) + 1
              return acc
            }, {}),
            radius_km: radiusKm,
            note:
              'Showing nearby OSM buildings. Flood-zone overlap counts are temporarily unavailable.',
          })
          setError(null)
        } catch (fallbackErr) {
          if (!cancelled) {
            setBuildings([])
            setSummary(null)
            setError(primaryErr || fallbackErr)
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [place?.lat, place?.lon, radiusKm, minTier])

  return { buildings, summary, loading, error }
}
