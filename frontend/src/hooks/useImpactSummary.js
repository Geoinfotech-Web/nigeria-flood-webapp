import { useEffect, useState } from 'react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

/**
 * Global (or scoped) impact-summary for Expert KPI strip.
 * Defaults to Nigeria-wide; optionally scopes to a selected station.
 */
export function useImpactSummary({ enabled = true, stationId = null } = {}) {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!enabled) {
      setSummary(null)
      return undefined
    }

    let cancelled = false
    const load = () => {
      setLoading(true)
      const params = new URLSearchParams()
      if (stationId) params.set('station_id', String(stationId))
      const qs = params.toString()
      fetch(`${API}/flood-risk/impact-summary${qs ? `?${qs}` : ''}`)
        .then((r) => {
          if (!r.ok) throw new Error(`impact-summary ${r.status}`)
          return r.json()
        })
        .then((data) => {
          if (!cancelled) {
            setSummary(data)
            setError(null)
          }
        })
        .catch((err) => {
          if (!cancelled) setError(err)
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }

    load()
    const id = setInterval(load, 300_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [enabled, stationId])

  return { summary, loading, error }
}
