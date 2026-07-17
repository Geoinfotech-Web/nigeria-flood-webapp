import { useEffect, useState } from 'react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

/**
 * Lightweight urban flash flood counts (same source as the map layer).
 */
export function useUrbanFlashSummary({ enabled = true } = {}) {
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
      fetch(`${API}/flood-risk/urban-flash-summary`)
        .then((r) => {
          if (!r.ok) throw new Error(`urban-flash-summary ${r.status}`)
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
    const id = setInterval(load, 300_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [enabled])

  return { summary, loading }
}
