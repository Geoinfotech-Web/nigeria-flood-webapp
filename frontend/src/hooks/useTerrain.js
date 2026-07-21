import { useEffect, useState } from 'react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

/**
 * Elevation + approximate slope for a lat/lon (Open-Meteo / SRTM via API).
 */
export function useTerrain(place) {
  const [terrain, setTerrain] = useState(null)
  const [loading, setLoading] = useState(false)

  const lat = place?.lat
  const lon = place?.lon

  useEffect(() => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      setTerrain(null)
      setLoading(false)
      return undefined
    }

    let cancelled = false
    setLoading(true)
    fetch(`${API}/geocode/terrain?lat=${lat}&lon=${lon}`)
      .then((r) => {
        if (!r.ok) throw new Error(`terrain ${r.status}`)
        return r.json()
      })
      .then((data) => {
        if (!cancelled) setTerrain(data)
      })
      .catch(() => {
        if (!cancelled) setTerrain(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [lat, lon])

  return { terrain, loading }
}
