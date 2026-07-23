/** Canonical prediction horizon labels used across Expert UI / PDF. */
export const HORIZON_KEYS = ['6h', '12h', '24h', '48h', '72h']

/**
 * API / BentoML historically returned numeric keys ("6", "24").
 * Normalize to "6h" / "24h" so UI lookups stay consistent.
 */
export function normalizeHorizons(horizons) {
  if (!horizons || typeof horizons !== 'object') return {}
  const out = {}
  for (const [raw, value] of Object.entries(horizons)) {
    if (value == null) continue
    let key = String(raw).trim().toLowerCase()
    if (/^\d+$/.test(key)) key = `${key}h`
    else if (/^\d+h$/.test(key)) {
      /* already canonical */
    } else if (key.endsWith('h') && /^\d/.test(key)) {
      /* keep */
    } else {
      const n = parseInt(key, 10)
      if (Number.isFinite(n)) key = `${n}h`
    }
    out[key] = value
  }
  return out
}

/** Read one horizon, accepting either "24h" or "24". */
export function getHorizon(horizons, key) {
  const normalized = normalizeHorizons(horizons)
  if (normalized[key]) return normalized[key]
  const bare = String(key).replace(/h$/i, '')
  return normalized[`${bare}h`] || null
}
