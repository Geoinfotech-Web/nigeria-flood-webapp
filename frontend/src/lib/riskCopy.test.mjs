import test from 'node:test'
import assert from 'node:assert/strict'
import { actionHint, expertPlaceAssessment, expertSiteSuitability, placeRiskMessage, worstRisk } from './riskCopy.js'
import { riskFromBank, stationRisk, worstNetworkRisk } from './stationRisk.js'

test('missing risk is unknown and does not erase elevated warnings', () => {
  assert.equal(worstRisk([]), 'Unknown')
  assert.equal(worstRisk([null, 'Normal']), 'Unknown')
  assert.equal(worstRisk(['Normal']), 'Normal')
  assert.equal(worstRisk(['Normal', 'invalid']), 'Unknown')
  assert.equal(worstRisk(['Unknown', 'Warning']), 'Warning')
})

test('missing site inputs cannot produce a reassuring suitability verdict', () => {
  const result = expertSiteSuitability({ slopeDeg: 1.9, gaugeTier: 'Unknown' })
  assert.equal(result.verdictTier, 'Unknown')
  assert.match(result.verdict, /Insufficient data/)
  assert.equal(result.uses.some((use) => use.includes('favourable')), false)
  assert.equal(expertSiteSuitability({ susceptibility: 'High', gaugeTier: 'Warning' }).verdictTier, 'Warning')
})

test('unknown descriptions do not claim a normal outlook', () => {
  assert.match(placeRiskMessage('Unknown', 'Lokoja'), /unavailable/)
  assert.match(expertPlaceAssessment('Unknown', 'Lokoja', 'Gauge'), /unavailable/)
  assert.match(actionHint('Unknown'), /official/)
})

test('missing gauge data is unknown, while actual elevated data is retained', () => {
  assert.equal(riskFromBank(null), 'Unknown')
  assert.equal(riskFromBank(NaN), 'Unknown')
  assert.equal(stationRisk(null, null, null), 'Unknown')
  assert.equal(riskFromBank(90), 'Warning')
  assert.equal(worstNetworkRisk([], {}, {}).worst, 'Unknown')
  const stations = [{ id: 1 }, { id: 2 }]
  assert.equal(worstNetworkRisk(stations, { 1: { pct_bank: 10 } }, {}).worst, 'Unknown')
  assert.equal(worstNetworkRisk(stations, { 1: { pct_bank: 90 } }, {}).worst, 'Warning')
})
