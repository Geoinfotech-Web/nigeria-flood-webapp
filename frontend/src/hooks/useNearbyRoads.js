import { useEffect, useState } from 'react'
import axios from 'axios'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

/**
 * Major roads near a searched / user location, classified by flood susceptibility.
 * Defaults to Moderate+ (min_susceptibility=2).
 */
export function useNearbyRoads(place, { radiusKm = 12, limit = 20, minSusceptibility = 2 } = {}) {
  const [roads, setRoads] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!place?.lat || !place?.lon) {
      setRoads([])
      setSummary(null)
      setError(null)
      return
    }

    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const { data } = await axios.get(`${API}/exposure/nearby-roads`, {
          params: {
            lat: place.lat,
            lon: place.lon,
            radius_km: radiusKm,
            limit,
            min_susceptibility: minSusceptibility,
          },
        })
        if (!cancelled) {
          setRoads(Array.isArray(data?.roads) ? data.roads : [])
          setSummary(data?.summary || null)
        }
      } catch (err) {
        if (!cancelled) {
          setRoads([])
          setSummary(null)
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
  }, [place?.lat, place?.lon, radiusKm, limit, minSusceptibility])

  return { roads, summary, loading, error }
}
