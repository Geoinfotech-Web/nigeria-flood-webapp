import { useCallback, useState } from 'react'
import axios from 'axios'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

/**
 * Browser geolocation → reverse geocode → place object for the outlook panel.
 */
export function useDetectLocation(onPlace) {
  const [locating, setLocating] = useState(false)
  const [error, setError] = useState(null)

  const detect = useCallback(() => {
    if (!navigator.geolocation) {
      setError('Location is not supported in this browser.')
      return
    }

    setLocating(true)
    setError(null)

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude: lat, longitude: lon } = position.coords
        try {
          const { data } = await axios.get(`${API}/geocode/reverse`, {
            params: { lat, lon },
          })
          onPlace?.({
            ...data,
            lat,
            lon,
            name: data.name || data.city || 'Your location',
            display_name: data.display_name || 'Your current location',
            from_geolocation: true,
          })
          setError(null)
        } catch {
          onPlace?.({
            name: 'Your location',
            display_name: `Near ${lat.toFixed(3)}°, ${lon.toFixed(3)}°`,
            lat,
            lon,
            bbox_lnglat: null,
            from_geolocation: true,
          })
          setError(null)
        } finally {
          setLocating(false)
        }
      },
      (err) => {
        setLocating(false)
        if (err.code === err.PERMISSION_DENIED) {
          setError('Location permission denied. Search for a place instead.')
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setError('Could not determine your location. Try again or search.')
        } else {
          setError('Location request timed out. Try again or search.')
        }
      },
      {
        enableHighAccuracy: false,
        timeout: 15000,
        maximumAge: 60_000,
      },
    )
  }, [onPlace])

  return { detect, locating, error, clearError: () => setError(null) }
}
