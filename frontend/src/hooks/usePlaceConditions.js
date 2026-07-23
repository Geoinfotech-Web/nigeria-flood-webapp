import { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { nearestStations } from '../lib/geo'
import { normalizeHorizons } from '../lib/horizons'
import { RISK_ORDER, worstRisk } from '../lib/riskCopy'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

/**
 * Resolve flood conditions for a searched place using nearest river gauges.
 * Inundation extent will plug in later; this is station-forecast based.
 */
export function usePlaceConditions(place, stations) {
  const [predictions, setPredictions] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const nearby = useMemo(() => {
    if (!place || !stations?.length) return []
    return nearestStations(stations, place.lat, place.lon, { limit: 5, maxKm: 220 })
  }, [place, stations])

  const nearbyKey = nearby.map((s) => s.id).join(',')

  useEffect(() => {
    if (!nearby.length) {
      setPredictions({})
      setError(null)
      setLoading(false)
      return
    }

    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const entries = await Promise.all(
          nearby.map(async (s) => {
            try {
              const { data } = await axios.get(`${API}/stations/${s.id}/predictions`)
              if (!data) return [s.id, null]
              return [
                s.id,
                { ...data, horizons: normalizeHorizons(data.horizons) },
              ]
            } catch {
              return [s.id, null]
            }
          }),
        )
        if (cancelled) return
        const next = {}
        entries.forEach(([id, data]) => {
          if (data) next[id] = data
        })
        setPredictions(next)
      } catch (err) {
        if (!cancelled) setError(err)
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
    // nearbyKey is a stable fingerprint of the nearest station set
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nearbyKey])

  const nearbyWithRisk = useMemo(
    () =>
      nearby.map((s) => ({
        ...s,
        prediction: predictions[s.id] || null,
        overall_risk: predictions[s.id]?.overall_risk || 'Normal',
      })),
    [nearby, predictions],
  )

  const overallRisk = nearbyWithRisk.length
    ? worstRisk(nearbyWithRisk.map((s) => s.overall_risk))
    : null

  const primaryStation = useMemo(() => {
    if (!nearbyWithRisk.length) return null
    return [...nearbyWithRisk].sort(
      (a, b) =>
        (RISK_ORDER[b.overall_risk] - RISK_ORDER[a.overall_risk]) ||
        (a.distance_km - b.distance_km),
    )[0]
  }, [nearbyWithRisk])

  return {
    nearby: nearbyWithRisk,
    overallRisk,
    primaryStation,
    loading,
    error,
    hasStations: nearbyWithRisk.length > 0,
  }
}
