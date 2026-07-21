import { useEffect, useState } from 'react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

/**
 * Latest daily rainfall total near a gauge (sum of day buckets for `days`).
 */
export function useStationRainfall({ stationId = null, days = 1, enabled = true } = {}) {
  const [totalMm, setTotalMm] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled || !stationId) {
      setTotalMm(null)
      setLoading(false)
      return undefined
    }

    let cancelled = false
    const load = () => {
      setLoading(true)
      fetch(`${API}/stations/${stationId}/rainfall?days=${days}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((rows) => {
          if (cancelled) return
          const list = Array.isArray(rows) ? rows : []
          const total = list.reduce((sum, row) => sum + (Number(row.total_rain_mm) || 0), 0)
          setTotalMm(list.length ? total : null)
        })
        .catch(() => {
          if (!cancelled) setTotalMm(null)
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }

    load()
    const id = setInterval(load, 60_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [enabled, stationId, days])

  return { totalMm, loading }
}
