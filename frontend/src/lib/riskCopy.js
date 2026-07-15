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

export function worstRisk(tiers) {
  return tiers.reduce(
    (worst, tier) => (RISK_ORDER[tier] > RISK_ORDER[worst] ? tier : worst),
    'Normal',
  )
}

/**
 * Plain-language guidance for residents and local responders.
 * Inundation extent maps are owned by another workstream — keep language place + gauge based.
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
