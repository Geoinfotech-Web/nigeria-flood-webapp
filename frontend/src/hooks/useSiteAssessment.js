import { useEffect, useState } from 'react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

/**
 * Point flood/site assessment for a searched or user location.
 */
export function useSiteAssessment(place) {
  const [assessment, setAssessment] = useState(null)
  const [loading, setLoading] = useState(false)

  const lat = place?.lat
  const lon = place?.lon

  useEffect(() => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      setAssessment(null)
      setLoading(false)
      return undefined
    }

    let cancelled = false
    setLoading(true)
    fetch(`${API}/exposure/site-assessment?lat=${lat}&lon=${lon}`)
      .then((r) => {
        if (!r.ok) throw new Error(`site-assessment ${r.status}`)
        return r.json()
      })
      .then((data) => {
        if (!cancelled) setAssessment(data)
      })
      .catch(() => {
        if (!cancelled) setAssessment(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [lat, lon])

  return { assessment, loading }
}
