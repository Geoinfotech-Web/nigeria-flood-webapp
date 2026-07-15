import { useEffect, useState } from 'react'
import axios from 'axios'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

/**
 * Neighbouring OSM cities / towns / villages around a place for the outlook panel.
 */
export function useNearbySettlements(place, { radiusKm = 25, limit = 8 } = {}) {
  const [settlements, setSettlements] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!place?.lat || !place?.lon) {
      setSettlements([])
      setError(null)
      return
    }

    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const { data } = await axios.get(`${API}/exposure/nearby-settlements`, {
          params: {
            lat: place.lat,
            lon: place.lon,
            radius_km: radiusKm,
            limit,
            exclude_name: place.name,
          },
        })
        if (!cancelled) setSettlements(Array.isArray(data) ? data : [])
      } catch (err) {
        if (!cancelled) {
          setSettlements([])
          setError(err)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [place?.lat, place?.lon, place?.name, radiusKm, limit])

  return { settlements, loading, error }
}
