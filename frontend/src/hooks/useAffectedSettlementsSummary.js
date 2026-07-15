import { useEffect, useState } from 'react'
import axios from 'axios'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

/**
 * National count of towns/villages near gauges with elevated (Warning+) flood outlook.
 */
export function useAffectedSettlementsSummary({ minTier = 'Warning', radiusKm = 25 } = {}) {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const { data } = await axios.get(`${API}/exposure/affected-settlements-summary`, {
          params: { min_tier: minTier, radius_km: radiusKm },
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
  }, [minTier, radiusKm])

  return { summary, loading, error }
}
