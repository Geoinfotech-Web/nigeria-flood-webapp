export const RISK_ORDER = {
  Normal: 0,
  Watch: 1,
  Warning: 2,
  Emergency: 3,
}

export const RISK_COLOR = {
  Normal: '#0d9488',
  Watch: '#ca8a04',
  Warning: '#ea580c',
  Emergency: '#dc2626',
}

/** Public-facing labels (avoid ops jargon where possible). */
export const RISK_LABEL = {
  Normal: 'No flood alert',
  Watch: 'Flood watch',
  Warning: 'Flood warning',
  Emergency: 'Flood emergency',
}

/** Matches GEE flood susceptibility class map (1–4). */
export const SUSCEPTIBILITY_ORDER = {
  Low: 1,
  Moderate: 2,
  High: 3,
  'Highly Susceptible': 4,
}

export const SUSCEPTIBILITY_COLOR = {
  Low: '#ffffb2',
  Moderate: '#fd8d3c',
  High: '#e31a1c',
  'Highly Susceptible': '#800026',
}

/** Darker text colours for Low (pale yellow is hard to read as text). */
export const SUSCEPTIBILITY_TEXT_COLOR = {
  Low: '#a16207',
  Moderate: '#c2410c',
  High: '#e31a1c',
  'Highly Susceptible': '#800026',
}

export function worstRisk(tiers) {
  return tiers.reduce(
    (worst, tier) => (RISK_ORDER[tier] > RISK_ORDER[worst] ? tier : worst),
    'Normal',
  )
}

/**
 * Plain-language guidance for residents and local responders.
 * Map Risk areas show SAR/DEM inundation (Very High / High / Moderate);
 * this copy stays place + gauge based for early warning.
 */
export function placeRiskMessage(tier, placeName, stationName) {
  const where = placeName || 'this area'
  const gauge = stationName ? ` Nearest monitored river: ${stationName}.` : ''

  switch (tier) {
    case 'Emergency':
      return `Severe flood conditions are forecast near ${where} within the next 72 hours.${gauge} Move to higher ground if advised by local authorities and treat this as an emergency signal.`
    case 'Warning':
      return `Flooding is likely near ${where} in the coming hours to days.${gauge} Prepare to protect people, property, and travel routes. Confirm with NIHSA and local emergency services.`
    case 'Watch':
      return `Elevated flood risk near ${where} over the next 72 hours.${gauge} Stay informed, avoid flood-prone roads, and review your household plan.`
    default:
      return `No significant flood alert for monitored rivers near ${where} right now.${gauge} Conditions can change — check back during heavy rain seasons.`
  }
}

export function actionHint(tier) {
  switch (tier) {
    case 'Emergency':
      return 'Act now — follow official evacuation or shelter guidance.'
    case 'Warning':
      return 'Prepare — secure belongings and plan alternate routes.'
    case 'Watch':
      return 'Monitor — keep watching forecasts and local advisories.'
    default:
      return 'Stay aware — forecasts cover the next 72 hours.'
  }
}

/**
 * Expert / operator assessment for a selected place (gauge-forecast based).
 * Public copy stays in placeRiskMessage / actionHint.
 */
export function expertPlaceAssessment(tier, placeName, stationName) {
  const where = placeName || 'this location'
  const gauge = stationName ? ` Gauge: ${stationName}.` : ' No nearby gauge in range.'

  switch (tier) {
    case 'Emergency':
      return `Critical 72h flood outlook near ${where}.${gauge} Escalate protective action with NIHSA / SEMMA.`
    case 'Warning':
      return `Flooding is likely near ${where} in the coming hours to days.${gauge} Raise readiness for people and critical roads.`
    case 'Watch':
      return `Elevated flood risk near ${where} over 72 hours.${gauge} Increase monitoring and pre-position local messaging.`
    default:
      return `No significant gauge-based flood alert near ${where} right now.${gauge} Keep routine surveillance during heavy rain.`
  }
}

/** Short operator checklist keyed by risk tier. */
export function expertActionItems(tier) {
  switch (tier) {
    case 'Emergency':
      return [
        'Confirm NIHSA / SEMMA guidance for the state',
        'Alert LGA focal points and restrict high-risk roads',
        'Watch the primary gauge for live level changes',
      ]
    case 'Warning':
      return [
        'Brief responders on the 72h gauge outlook',
        'Identify high-susceptibility settlements and roads',
        'Reassess after heavy rain or within 6–12 hours',
      ]
    case 'Watch':
      return [
        'Monitor nearest-gauge forecasts regularly',
        'Watchlist highly susceptible places and roads',
        'Escalate if flood probabilities rise',
      ]
    default:
      return [
        'Maintain routine gauge and rainfall checks',
        'Note flat / low-lying terrain near the place',
        'Re-run this report if conditions worsen',
      ]
  }
}

/**
 * Site suitability for housing / land decisions at the exact selected location.
 * Combines point susceptibility, terrain, gauge outlook, and hazard zones.
 */
export function expertSiteSuitability({
  susceptibility,
  slopeDeg,
  slopeClass,
  elevationM,
  gaugeTier,
  zonesInside = [],
  zonesNearby = [],
} = {}) {
  const reasons = []
  const uses = []
  let score = 0 // higher = more flood concern

  const susOrder = SUSCEPTIBILITY_ORDER[susceptibility] || 0
  if (susceptibility) {
    score += Math.max(0, susOrder - 1)
    if (susOrder >= 4) {
      reasons.push(
        `This exact location is classified as ${susceptibility} on the flood susceptibility map (terrain + historical inundation signals).`,
      )
    } else if (susOrder >= 3) {
      reasons.push(
        `This location has ${susceptibility} flood susceptibility — flooding is more likely during extreme rainfall or river overflow.`,
      )
    } else if (susOrder === 2) {
      reasons.push(
        `Flood susceptibility at this point is Moderate — possible waterlogging in heavy rain seasons.`,
      )
    } else {
      reasons.push(
        `Flood susceptibility at this point is Low relative to surrounding terrain.`,
      )
    }
  } else {
    reasons.push('Point flood susceptibility could not be sampled for this coordinate yet.')
  }

  if (slopeDeg != null) {
    if (slopeDeg < 1) {
      score += 2
      reasons.push(
        `Terrain is very flat (${slopeDeg}°${slopeClass ? ` · ${slopeClass}` : ''}) — water can pond and drain slowly.`,
      )
    } else if (slopeDeg < 3) {
      score += 1
      reasons.push(
        `Slope is flat (${slopeDeg}°${slopeClass ? ` · ${slopeClass}` : ''}) — mild drainage limitations during intense rain.`,
      )
    } else if (slopeDeg >= 8) {
      score -= 1
      reasons.push(
        `Slope is ${slopeClass || 'steeper'} (${slopeDeg}°) — better natural drainage than low-lying flats, but check runoff paths.`,
      )
    } else {
      reasons.push(
        `Slope is ${slopeClass || 'gentle'} (${slopeDeg}°) — typical drainage for this area.`,
      )
    }
  }

  if (elevationM != null) {
    reasons.push(`Ground elevation is about ${elevationM} m above sea level (SRTM).`)
  }

  const insideWorst = zonesInside[0]
  if (insideWorst) {
    score += insideWorst.risk_tier === 'Very High' || insideWorst.risk_tier === 'Highly Likely' || insideWorst.risk_tier === 'Emergency'
      ? 3
      : insideWorst.risk_tier === 'High' || insideWorst.risk_tier === 'Likely' || insideWorst.risk_tier === 'Warning'
        ? 2
        : 1
    const kind =
      insideWorst.source === 'urban_flash_flood'
        ? 'urban flash-flood'
        : 'riverine inundation probability'
    reasons.push(
      `The point sits inside a ${kind} zone rated ${insideWorst.risk_tier}${insideWorst.name ? ` (${insideWorst.name})` : ''}.`,
    )
  } else if (zonesNearby[0]) {
    score += 1
    const z = zonesNearby[0]
    const kind = z.source === 'urban_flash_flood' ? 'urban flash-flood' : 'inundation'
    reasons.push(
      `A ${kind} zone (${z.risk_tier}) is about ${z.distance_km} km from this point.`,
    )
  } else {
    reasons.push('No mapped inundation or urban flash zone currently intersects this exact point.')
  }

  const gaugeScore = RISK_ORDER[gaugeTier] || 0
  if (gaugeScore >= 2) {
    score += gaugeScore
    reasons.push(
      `Nearest river gauge outlook is ${gaugeTier} within 72 hours — flood risk can affect access and utilities even if the plot itself is dry.`,
    )
  } else if (gaugeTier) {
    reasons.push(`Nearest monitored river outlook is currently ${gaugeTier}.`)
  }

  let verdict = 'Suitable with normal awareness'
  let verdictTier = 'Normal'
  if (score >= 6) {
    verdict = 'Not recommended for housing or land purchase without specialist flood assessment'
    verdictTier = 'Emergency'
  } else if (score >= 4) {
    verdict = 'High caution — elevated flood exposure for accommodation or development'
    verdictTier = 'Warning'
  } else if (score >= 2) {
    verdict = 'Proceed with caution — review drainage and seasonal flood history'
    verdictTier = 'Watch'
  }

  if (verdictTier === 'Normal' || verdictTier === 'Watch') {
    uses.push('Generally more favourable for residential search than high-susceptibility flats')
    uses.push('Still verify local drainage, estate fill level, and access roads in rainy season')
  }
  if (verdictTier === 'Watch' || verdictTier === 'Warning') {
    uses.push('Ask sellers/agents about past flooding, ground floor levels, and insurance')
    uses.push('Prefer elevated foundations and check alternate dry-season access routes')
  }
  if (verdictTier === 'Warning' || verdictTier === 'Emergency') {
    uses.push('Not ideal for long-term housing or land banking without engineering mitigation')
    uses.push('Useful as a screening flag before site visits or purchase commitments')
  }
  uses.push('Cross-check with NIHSA / local planning guidance before final decisions')

  return {
    verdict,
    verdictTier,
    score,
    reasons,
    uses,
    susceptibility: susceptibility || null,
  }
}
