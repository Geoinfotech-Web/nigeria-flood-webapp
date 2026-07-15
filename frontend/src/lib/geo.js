/** Haversine distance in kilometres between two WGS84 points. */
export function distanceKm(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180
  const R = 6371
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Return stations sorted by distance to a place, with `distance_km` attached. */
export function nearestStations(stations, lat, lon, { limit = 5, maxKm = 200 } = {}) {
  return stations
    .map((s) => ({
      ...s,
      distance_km: distanceKm(lat, lon, s.lat, s.lon),
    }))
    .filter((s) => s.distance_km <= maxKm)
    .sort((a, b) => a.distance_km - b.distance_km)
    .slice(0, limit)
}

export function formatDistance(km) {
  if (km == null || Number.isNaN(km)) return '—'
  if (km < 1) return `${Math.round(km * 1000)} m`
  if (km < 10) return `${km.toFixed(1)} km`
  return `${Math.round(km)} km`
}
