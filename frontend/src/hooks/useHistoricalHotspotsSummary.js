import { useEffect, useState } from 'react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export function useHistoricalHotspotsSummary({ enabled = true } = {}) {
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setSummary(null)
      return undefined
    }

    let cancelled = false
    const load = () => {
      setLoading(true)
      fetch(`${API}/flood-risk/historical-hotspots/summary`)
        .then((r) => {
          if (!r.ok) throw new Error(`historical-hotspots-summary ${r.status}`)
          return r.json()
        })
        .then((data) => {
          if (!cancelled) setSummary(data)
        })
        .catch(() => {
          if (!cancelled) setSummary(null)
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }

    load()
    const id = setInterval(load, 600_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [enabled])

  return { summary, loading }
}
