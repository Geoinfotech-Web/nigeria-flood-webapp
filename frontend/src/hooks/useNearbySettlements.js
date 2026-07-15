import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import {
  classifySettlementsByRisk,
  sortSettlementsByRisk,
  summarizeSettlementsByRisk,
} from '../lib/settlementRisk'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

/**
 * Neighbouring settlements with GEE susceptibility + nearest-gauge flood risk.
 * @param {object|null} place
 * @param {array} gaugesWithRisk - gauges with lat/lon + overall_risk (from usePlaceConditions.nearby)
 */
export function useNearbySettlements(place, gaugesWithRisk = [], { radiusKm = 25, limit = 12 } = {}) {
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

  const classified = useMemo(
    () => sortSettlementsByRisk(classifySettlementsByRisk(settlements, gaugesWithRisk)),
    [settlements, gaugesWithRisk],
  )

  const localSummary = useMemo(
    () => summarizeSettlementsByRisk(classified),
    [classified],
  )

  return { settlements: classified, localSummary, loading, error }
}
