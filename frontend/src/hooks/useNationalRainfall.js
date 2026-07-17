import { useEffect, useMemo, useState } from 'react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

/**
 * Daily rainfall across met stations. Returns raw rows + per-day national averages.
 */
export function useNationalRainfall({ enabled = true, days = 7 } = {}) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setRows([])
      return undefined
    }
    let cancelled = false
    const load = () => {
      setLoading(true)
      fetch(`${API}/rainfall/daily?days=${days}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => {
          if (!cancelled) setRows(Array.isArray(data) ? data : [])
        })
        .catch(() => {
          if (!cancelled) setRows([])
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
  }, [enabled, days])

  const dailyAverage = useMemo(() => {
    const byDate = {}
    for (const r of rows) {
      const d = (r.date || '').slice(0, 10)
      if (!d) continue
      if (!byDate[d]) byDate[d] = { sum: 0, n: 0 }
      byDate[d].sum += Number(r.total_rain_mm) || 0
      byDate[d].n += 1
    }
    return Object.keys(byDate)
      .sort()
      .map((date) => ({
        date,
        avg_mm: byDate[date].n ? byDate[date].sum / byDate[date].n : 0,
      }))
  }, [rows])

  const latestAvgMm = dailyAverage.length
    ? dailyAverage[dailyAverage.length - 1].avg_mm
    : null

  return { rows, dailyAverage, latestAvgMm, loading }
}
