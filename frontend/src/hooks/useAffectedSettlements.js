import { useEffect, useState } from 'react'
import axios from 'axios'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export function useAffectedSettlements({
  enabled = true,
  minTier = 'Warning',
  radiusKm = 25,
  state = 'All',
  placeClass = 'All',
  riskTier = 'All',
  query = '',
  limit = 120,
} = {}) {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!enabled) {
      setSummary(null)
      return undefined
    }

    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const { data } = await axios.get(`${API}/exposure/affected-settlements-summary`, {
          params: {
            min_tier: minTier,
            radius_km: radiusKm,
            state: state !== 'All' ? state : undefined,
            place_class: placeClass !== 'All' ? placeClass : undefined,
            risk_tier: riskTier !== 'All' ? riskTier : undefined,
            q: query.trim() || undefined,
            limit,
          },
        })
        if (!cancelled) {
          setSummary(data)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err)
          setSummary(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    const id = setInterval(load, 60_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [enabled, minTier, radiusKm, state, placeClass, riskTier, query, limit])

  return { summary, loading, error }
}
