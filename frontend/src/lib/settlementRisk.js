import { distanceKm } from './geo'

/**
 * Assign each settlement the flood risk of its nearest monitored gauge.
 */
export function classifySettlementsByRisk(settlements, gauges = []) {
  if (!settlements?.length) return []
  const usable = gauges.filter(
    (g) => Number.isFinite(g.lat) && Number.isFinite(g.lon),
  )

  return settlements.map((s) => {
    if (!usable.length) {
      return {
        ...s,
        risk_tier: 'Normal',
        nearest_gauge: null,
        distance_to_gauge_km: null,
      }
    }

    let nearest = usable[0]
    let bestD = distanceKm(s.lat, s.lon, nearest.lat, nearest.lon)
    for (let i = 1; i < usable.length; i += 1) {
      const g = usable[i]
      const d = distanceKm(s.lat, s.lon, g.lat, g.lon)
      if (d < bestD) {
        bestD = d
        nearest = g
      }
    }

    return {
      ...s,
      risk_tier: nearest.overall_risk || nearest.risk_tier || 'Normal',
      nearest_gauge: nearest.name || null,
      distance_to_gauge_km: Math.round(bestD * 10) / 10,
    }
  })
}

export function summarizeSettlementsByRisk(classified = []) {
  const by_tier = { Emergency: 0, Warning: 0, Watch: 0, Normal: 0 }
  const by_class = { City: 0, Town: 0, Village: 0 }
  const by_susceptibility = {
    'Highly Susceptible': 0,
    High: 0,
    Moderate: 0,
    Low: 0,
  }

  classified.forEach((s) => {
    const tier = by_tier[s.risk_tier] != null ? s.risk_tier : 'Normal'
    by_tier[tier] += 1
    if (by_class[s.class] != null) by_class[s.class] += 1
    const sus = s.susceptibility
    if (sus && by_susceptibility[sus] != null) by_susceptibility[sus] += 1
  })

  const highlyLikely = by_tier.Warning + by_tier.Emergency
  const highlySusceptible =
    by_susceptibility['Highly Susceptible'] + by_susceptibility.High

  return {
    total: classified.length,
    highly_likely: highlyLikely,
    highly_susceptible: highlySusceptible,
    by_tier,
    by_class,
    by_susceptibility,
    radius_km: 25,
  }
}

/** Sort highest susceptibility first, then gauge risk, then closer. */
export function sortSettlementsByRisk(classified = []) {
  const gaugeOrder = { Emergency: 0, Warning: 1, Watch: 2, Normal: 3 }
  return [...classified].sort(
    (a, b) =>
      (b.susceptibility_class ?? 0) - (a.susceptibility_class ?? 0) ||
      (gaugeOrder[a.risk_tier] ?? 9) - (gaugeOrder[b.risk_tier] ?? 9) ||
      (a.distance_km ?? 999) - (b.distance_km ?? 999),
  )
}
