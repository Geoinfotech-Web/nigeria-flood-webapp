import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

/**
 * Batch flood predictions for all gauges (Expert network triage).
 * Returns { byStation, updatedAt, loading }.
 */
export function useAllPredictions(enabled = true) {
  const [predictions, setPredictions] = useState([])
  const [updatedAt, setUpdatedAt] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false

    const load = () => {
      setLoading(true)
      axios
        .get(`${API}/stations/all/predictions`)
        .then((r) => {
          if (cancelled) return
          setPredictions(Array.isArray(r.data) ? r.data : [])
          setUpdatedAt(new Date())
        })
        .catch(() => {
          if (!cancelled) setPredictions([])
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }

    load()
    const id = setInterval(load, 90_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [enabled])

  const byStation = useMemo(() => {
    const map = {}
    for (const p of predictions) {
      if (p?.station_id == null) continue
      const id = Number(p.station_id)
      map[id] = p
      map[p.station_id] = p
    }
    return map
  }, [predictions])

  return { byStation, updatedAt, loading }
}
