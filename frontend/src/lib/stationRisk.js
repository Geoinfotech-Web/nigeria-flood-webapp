export const RISK_ORDER = { Normal: 0, Watch: 1, Warning: 2, Emergency: 3 }

export function bankPct(station, reading) {
  if (!reading) return null
  if (reading.pct_bank != null) return Number(reading.pct_bank)
  if (station?.bank_full_m && reading.water_level_m != null) {
    return Math.round((reading.water_level_m / station.bank_full_m) * 1000) / 10
  }
  return null
}

export function riskFromBank(pct) {
  if (pct == null) return 'Normal'
  if (pct >= 100) return 'Emergency'
  if (pct >= 85) return 'Warning'
  if (pct >= 70) return 'Watch'
  return 'Normal'
}

export function stationRisk(reading, pred, pct) {
  if (reading?.risk_tier && RISK_ORDER[reading.risk_tier] != null) return reading.risk_tier
  if (pred?.overall_risk && RISK_ORDER[pred.overall_risk] != null) return pred.overall_risk
  return riskFromBank(pct)
}

export function worstNetworkRisk(stations, liveReadings, predictionsByStation) {
  let worst = 'Normal'
  const elevatedStates = new Set()
  for (const s of stations) {
    const reading = liveReadings[s.id]
    const pct = bankPct(s, reading)
    const pred = predictionsByStation[s.id]
    const risk = stationRisk(reading, pred, pct)
    if (RISK_ORDER[risk] > RISK_ORDER[worst]) worst = risk
    if (RISK_ORDER[risk] >= RISK_ORDER.Watch && s.state) elevatedStates.add(s.state)
  }
  return { worst, elevatedStates: [...elevatedStates].sort() }
}

export function formatPopulation(n) {
  if (n == null || !Number.isFinite(n)) return null
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}
