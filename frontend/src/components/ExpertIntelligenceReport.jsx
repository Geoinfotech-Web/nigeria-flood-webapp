import React, { useMemo } from 'react'
import clsx from 'clsx'
import { formatDistance } from '../lib/geo'
import {
  RISK_COLOR,
  RISK_LABEL,
  SUSCEPTIBILITY_COLOR,
  SUSCEPTIBILITY_TEXT_COLOR,
  expertActionItems,
  expertPlaceAssessment,
  expertSiteSuitability,
} from '../lib/riskCopy'
import { exportIntelligenceReportPdf } from '../lib/exportIntelligenceReportPdf'
import { IconAlertTriangle, IconDownload, IconGauge, IconX } from './Icons'
import GaugeChart from './GaugeChart'
import RainfallChart from './RainfallChart'

const LIGHT_BADGE = {
  Normal: 'bg-teal-50 text-teal-800 border-teal-200',
  Watch: 'bg-amber-50 text-amber-900 border-amber-200',
  Warning: 'bg-orange-50 text-orange-900 border-orange-200',
  Emergency: 'bg-red-50 text-red-900 border-red-200',
}

const DARK_BADGE = {
  Normal: 'bg-teal-950/70 text-teal-200 border-teal-800',
  Watch: 'bg-amber-950/70 text-amber-200 border-amber-800',
  Warning: 'bg-orange-950/70 text-orange-200 border-orange-800',
  Emergency: 'bg-red-950/70 text-red-200 border-red-800',
}

const HORIZON_KEYS = ['6h', '12h', '24h', '48h', '72h']

function Section({ title, theme, children, action = null }) {
  const dark = theme === 'dark'
  return (
    <section
      className={clsx(
        'rounded-lg border px-3 py-2.5',
        dark ? 'border-gray-800 bg-gray-900/40' : 'border-slate-200 bg-slate-50/80',
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3
          className={clsx(
            'text-[10px] font-semibold uppercase tracking-widest',
            dark ? 'text-gray-500' : 'text-slate-500',
          )}
        >
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  )
}

function Metric({ label, value, theme, sub = null }) {
  const dark = theme === 'dark'
  return (
    <div
      className={clsx(
        'rounded-lg border px-2.5 py-2',
        dark ? 'border-gray-800 bg-gray-950/40' : 'border-slate-200 bg-white',
      )}
    >
      <p className={clsx('text-[9px] uppercase tracking-wide', dark ? 'text-gray-500' : 'text-slate-500')}>
        {label}
      </p>
      <p className={clsx('mt-0.5 text-sm font-bold tabular-nums', dark ? 'text-white' : 'text-slate-900')}>
        {value}
      </p>
      {sub ? (
        <p className={clsx('mt-0.5 truncate text-[10px]', dark ? 'text-gray-500' : 'text-slate-500')}>
          {sub}
        </p>
      ) : null}
    </div>
  )
}

function SusceptibilityChip({ value, theme }) {
  if (!value) return null
  const color = SUSCEPTIBILITY_TEXT_COLOR[value] || (theme === 'dark' ? '#9ca3af' : '#64748b')
  const bg = SUSCEPTIBILITY_COLOR[value] || 'transparent'
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold"
      style={{
        color,
        borderColor: color,
        backgroundColor: theme === 'dark' ? `${bg}22` : `${bg}55`,
      }}
    >
      {value}
    </span>
  )
}

function roadKey(r) {
  return `${r.osm_id || r.name}-${r.lat}-${r.lon}`
}

function roadLabel(r) {
  return (r.name || r.ref || `Unnamed ${r.class || 'road'}`).trim()
}

export default function ExpertIntelligenceReport({
  place,
  overallRisk,
  primaryStation,
  nearby = [],
  nearbySettlements = [],
  localSettlementSummary = null,
  settlementsLoading = false,
  nearbyRoads = [],
  roadSummary = null,
  roadsLoading = false,
  selectedRoad = null,
  onSelectRoad,
  onSelectPlace,
  terrain = null,
  terrainLoading = false,
  siteAssessment = null,
  siteLoading = false,
  loading = false,
  liveReadings = {},
  theme = 'dark',
  onClose,
  onSelectStation,
}) {
  const dark = theme === 'dark'
  const tier = overallRisk || 'Normal'
  const badge = (dark ? DARK_BADGE : LIGHT_BADGE)[tier] || LIGHT_BADGE.Normal
  const horizons = primaryStation?.prediction?.horizons || {}
  const actions = useMemo(() => expertActionItems(tier), [tier])
  const assessment = useMemo(
    () => expertPlaceAssessment(tier, place?.name, primaryStation?.name),
    [tier, place?.name, primaryStation?.name],
  )

  const pointSusceptibility =
    siteAssessment?.susceptibility || place?.susceptibility || null

  const suitability = useMemo(
    () =>
      expertSiteSuitability({
        susceptibility: pointSusceptibility,
        slopeDeg: terrain?.slope_deg,
        slopeClass: terrain?.slope_class,
        elevationM: terrain?.elevation_m,
        gaugeTier: tier,
        zonesInside: siteAssessment?.zones_inside || [],
        zonesNearby: siteAssessment?.zones_nearby || [],
      }),
    [pointSusceptibility, terrain, tier, siteAssessment],
  )

  const siteBadge =
    (dark ? DARK_BADGE : LIGHT_BADGE)[suitability.verdictTier] || badge

  const roadsAtRisk = roadSummary?.at_risk ?? 0
  const placeMeta = [place?.class, place?.state].filter(Boolean).join(' · ')

  const handleExport = () => {
    exportIntelligenceReportPdf({
      place,
      overallRisk: tier,
      primaryStation,
      terrain,
      site: siteAssessment,
      suitability,
      actions,
      horizons,
      roads: nearbyRoads,
      settlements: nearbySettlements,
      gauges: nearby,
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={clsx(
          'shrink-0 border-b px-4 pt-3 pb-2.5',
          dark ? 'border-gray-800' : 'border-slate-200',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-0.5 flex flex-wrap items-center gap-2">
              <p
                className={clsx(
                  'text-[10px] font-semibold uppercase tracking-widest',
                  dark ? 'text-gray-500' : 'text-slate-500',
                )}
              >
                Location intelligence
              </p>
              <span className={clsx('rounded-full border px-1.5 py-0.5 text-[9px] font-semibold', badge)}>
                {RISK_LABEL[tier] || tier}
              </span>
            </div>
            <h2
              className={clsx(
                'truncate text-sm font-semibold leading-tight',
                dark ? 'text-white' : 'text-slate-900',
              )}
            >
              {place?.name || 'Selected place'}
            </h2>
            <p className={clsx('mt-0.5 truncate text-xs', dark ? 'text-gray-400' : 'text-slate-500')}>
              {placeMeta || place?.display_name || '—'}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={handleExport}
              className={clsx(
                'inline-flex h-8 items-center gap-1 rounded-lg border px-2 text-[10px] font-semibold transition',
                dark
                  ? 'border-gray-700/70 bg-gray-800/70 text-gray-300 hover:text-white'
                  : 'border-slate-200 bg-slate-100 text-slate-600 hover:text-slate-900',
              )}
              title="Download / print report as PDF"
            >
              <IconDownload size={12} />
              PDF
            </button>
            <button
              type="button"
              onClick={onClose}
              className={clsx(
                'inline-flex h-8 w-8 items-center justify-center rounded-lg border transition',
                dark
                  ? 'border-gray-700/70 bg-gray-800/70 text-gray-400 hover:text-white'
                  : 'border-slate-200 bg-slate-100 text-slate-500 hover:text-slate-900',
              )}
              aria-label="Close intelligence report"
              title="Back to network overview"
            >
              <IconX size={14} />
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3">
        {(loading || siteLoading) && (
          <div
            className={clsx(
              'rounded-lg border px-3 py-3 text-center text-xs',
              dark ? 'border-gray-800 text-gray-400' : 'border-slate-200 text-slate-500',
            )}
          >
            Assessing this location…
          </div>
        )}

        <Section title="This location" theme={theme}>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className={clsx('rounded-full border px-2 py-0.5 text-[10px] font-semibold', siteBadge)}>
              {suitability.verdictTier}
            </span>
            <SusceptibilityChip value={pointSusceptibility} theme={theme} />
          </div>
          <p className={clsx('text-xs font-semibold leading-snug', dark ? 'text-gray-100' : 'text-slate-900')}>
            {suitability.verdict}
          </p>
          <ul className="mt-2 space-y-1.5">
            {suitability.reasons.map((reason) => (
              <li
                key={reason}
                className={clsx('flex gap-2 text-[11px] leading-snug', dark ? 'text-gray-300' : 'text-slate-700')}
              >
                <span
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ color: RISK_COLOR[suitability.verdictTier], background: RISK_COLOR[suitability.verdictTier] }}
                />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
          <div className={clsx('mt-2.5 border-t pt-2', dark ? 'border-gray-800' : 'border-slate-200')}>
            <p
              className={clsx(
                'mb-1 text-[9px] font-semibold uppercase tracking-wide',
                dark ? 'text-gray-500' : 'text-slate-500',
              )}
            >
              Useful for housing · land · accommodation
            </p>
            <ul className="space-y-1">
              {suitability.uses.map((use) => (
                <li
                  key={use}
                  className={clsx('text-[11px] leading-snug', dark ? 'text-gray-400' : 'text-slate-600')}
                >
                  · {use}
                </li>
              ))}
            </ul>
          </div>
        </Section>

        <div
          className={clsx(
            'rounded-lg border px-3 py-2.5',
            dark ? 'border-gray-800 bg-gray-900/60' : 'border-slate-200 bg-white',
          )}
        >
          <div className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0" style={{ color: RISK_COLOR[tier] }}>
              <IconAlertTriangle size={14} />
            </span>
            <p className={clsx('text-xs leading-relaxed', dark ? 'text-gray-200' : 'text-slate-800')}>
              {assessment}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <Metric theme={theme} label="72h gauge outlook" value={tier} />
          <Metric
            theme={theme}
            label="Primary gauge"
            value={primaryStation ? formatDistance(primaryStation.distance_km) : '—'}
            sub={primaryStation?.name}
          />
          <Metric
            theme={theme}
            label="Elevation"
            value={
              terrainLoading
                ? '…'
                : terrain?.elevation_m != null
                  ? `${terrain.elevation_m} m`
                  : '—'
            }
          />
          <Metric
            theme={theme}
            label="Slope"
            value={
              terrainLoading
                ? '…'
                : terrain?.slope_deg != null
                  ? `${terrain.slope_deg}°`
                  : '—'
            }
            sub={terrain?.slope_class || null}
          />
        </div>

        <Section title="Advisory" theme={theme}>
          <ul className="space-y-1.5">
            {actions.map((item) => (
              <li
                key={item}
                className={clsx(
                  'flex gap-2 text-[11px] leading-snug',
                  dark ? 'text-gray-300' : 'text-slate-700',
                )}
              >
                <span
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: RISK_COLOR[tier] }}
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className={clsx('mt-2 text-[10px]', dark ? 'text-gray-500' : 'text-slate-500')}>
            Advisory screening only — confirm with NIHSA before operational or purchase decisions.
          </p>
        </Section>

        <Section
          title="72h outlook & rainfall"
          theme={theme}
          action={
            primaryStation ? (
              <button
                type="button"
                onClick={() => onSelectStation?.(primaryStation.id)}
                className={clsx(
                  'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold transition',
                  dark
                    ? 'bg-sky-950/50 text-sky-300 hover:bg-sky-900/60'
                    : 'bg-sky-100 text-sky-800 hover:bg-sky-200',
                )}
              >
                <IconGauge size={11} />
                Console
              </button>
            ) : null
          }
        >
          {primaryStation ? (
            <div className="space-y-2">
              <div className="grid grid-cols-5 gap-1">
                {HORIZON_KEYS.map((key) => {
                  const h = horizons[key]
                  const prob = h?.flood_prob
                  const pct = prob == null ? null : Math.round(prob <= 1 ? prob * 100 : prob)
                  const hTier = h?.risk_tier || 'Normal'
                  return (
                    <div
                      key={key}
                      className={clsx(
                        'rounded-md border px-1 py-1.5 text-center',
                        dark ? 'border-gray-800 bg-gray-950/50' : 'border-slate-200 bg-white',
                      )}
                    >
                      <p className={clsx('text-[9px]', dark ? 'text-gray-500' : 'text-slate-500')}>
                        {key}
                      </p>
                      <p
                        className="mt-0.5 text-[11px] font-bold tabular-nums"
                        style={{ color: RISK_COLOR[hTier] || undefined }}
                      >
                        {pct != null ? `${pct}%` : '—'}
                      </p>
                    </div>
                  )
                })}
              </div>
              <GaugeChart
                stationId={primaryStation.id}
                liveReading={liveReadings?.[primaryStation.id]}
                theme={theme}
                mode="readings"
                hours={24}
                title="Water level — 24h"
                height={100}
              />
              <RainfallChart
                stationId={primaryStation.id}
                stationName={primaryStation.name}
                theme={theme}
              />
            </div>
          ) : (
            <p className={clsx('text-[11px]', dark ? 'text-gray-500' : 'text-slate-500')}>
              No monitored gauge within range for outlook or rainfall charts.
            </p>
          )}
        </Section>

        <Section title="Roads at risk" theme={theme}>
          {roadsLoading && nearbyRoads.length === 0 ? (
            <p className={clsx('text-[11px]', dark ? 'text-gray-500' : 'text-slate-500')}>
              Loading roads…
            </p>
          ) : nearbyRoads.length === 0 ? (
            <p className={clsx('text-[11px]', dark ? 'text-gray-500' : 'text-slate-500')}>
              No moderate+ susceptibility roads nearby.
            </p>
          ) : (
            <>
              <p className={clsx('mb-1.5 text-[10px]', dark ? 'text-gray-500' : 'text-slate-500')}>
                {roadsAtRisk} high / highly susceptible · tap to highlight on map
              </p>
              <ul className="max-h-40 space-y-1 overflow-y-auto">
                {nearbyRoads.slice(0, 12).map((r) => {
                  const key = roadKey(r)
                  const active =
                    selectedRoad &&
                    (selectedRoad.osm_id
                      ? selectedRoad.osm_id === r.osm_id
                      : roadKey(selectedRoad) === key)
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        onClick={() => onSelectRoad?.(active ? null : r)}
                        className={clsx(
                          'flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-[11px] transition',
                          active
                            ? dark
                              ? 'border-sky-500 bg-sky-950/40 ring-1 ring-sky-500/30'
                              : 'border-sky-400 bg-sky-50 ring-1 ring-sky-300'
                            : dark
                              ? 'border-gray-800 bg-gray-950/40 hover:border-gray-600'
                              : 'border-slate-200 bg-white hover:border-slate-300',
                        )}
                      >
                        <span className="min-w-0">
                          <span
                            className={clsx(
                              'block truncate font-medium',
                              dark ? 'text-gray-100' : 'text-slate-800',
                            )}
                          >
                            {roadLabel(r)}
                          </span>
                          <span
                            className={clsx(
                              'block truncate text-[10px]',
                              dark ? 'text-gray-500' : 'text-slate-400',
                            )}
                          >
                            {r.class || 'road'}
                            {r.bridge ? ' · bridge' : ''}
                            {' · '}
                            {formatDistance(r.distance_km)}
                            {active ? ' · on map' : ''}
                          </span>
                        </span>
                        <SusceptibilityChip value={r.susceptibility} theme={theme} />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </Section>

        <Section title="Nearby places" theme={theme}>
          {settlementsLoading && nearbySettlements.length === 0 ? (
            <p className={clsx('text-[11px]', dark ? 'text-gray-500' : 'text-slate-500')}>
              Loading places…
            </p>
          ) : nearbySettlements.length === 0 ? (
            <p className={clsx('text-[11px]', dark ? 'text-gray-500' : 'text-slate-500')}>
              No nearby settlements in range.
            </p>
          ) : (
            <>
              <p className={clsx('mb-1.5 text-[10px]', dark ? 'text-gray-500' : 'text-slate-500')}>
                Tap a place to open its intelligence report
              </p>
              <ul className="max-h-36 space-y-1 overflow-y-auto">
                {nearbySettlements.slice(0, 8).map((s) => (
                  <li key={`${s.name}-${s.lat}-${s.lon}`}>
                    <button
                      type="button"
                      onClick={() =>
                        onSelectPlace?.({
                          name: s.name,
                          display_name: s.display_name || `${s.name}, Nigeria`,
                          lat: s.lat,
                          lon: s.lon,
                          bbox_lnglat: null,
                          class: s.class || null,
                          population: s.population ?? null,
                          susceptibility: s.susceptibility || null,
                          susceptibility_class: s.susceptibility_class ?? null,
                        })
                      }
                      className={clsx(
                        'flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-[11px] transition',
                        dark
                          ? 'border-gray-800 bg-gray-950/40 hover:border-gray-600'
                          : 'border-slate-200 bg-white hover:border-slate-300',
                      )}
                    >
                      <span className="min-w-0 truncate">
                        <span className={clsx('font-medium', dark ? 'text-gray-200' : 'text-slate-800')}>
                          {s.name}
                        </span>
                        <span className={clsx('ml-1', dark ? 'text-gray-500' : 'text-slate-400')}>
                          {s.class || ''}
                          {s.distance_km != null ? ` · ${formatDistance(s.distance_km)}` : ''}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <SusceptibilityChip value={s.susceptibility} theme={theme} />
                        <span
                          className="text-[10px] font-semibold"
                          style={{ color: RISK_COLOR[s.risk_tier] || undefined }}
                        >
                          {s.risk_tier || '—'}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>

        <Section title="Monitoring stations" theme={theme}>
          {nearby.length === 0 ? (
            <p className={clsx('text-[11px]', dark ? 'text-gray-500' : 'text-slate-500')}>
              No gauges within 220 km.
            </p>
          ) : (
            <ul className="space-y-1">
              {nearby.slice(0, 5).map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => onSelectStation?.(s.id)}
                    className={clsx(
                      'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition',
                      dark ? 'hover:bg-gray-800/80' : 'hover:bg-white',
                    )}
                  >
                    <span className="min-w-0">
                      <span
                        className={clsx(
                          'block truncate font-medium',
                          dark ? 'text-gray-100' : 'text-slate-800',
                        )}
                      >
                        {s.name}
                      </span>
                      <span className={clsx('text-[10px]', dark ? 'text-gray-500' : 'text-slate-500')}>
                        {s.river} · {formatDistance(s.distance_km)}
                      </span>
                    </span>
                    <span
                      className={clsx(
                        'shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold',
                        (dark ? DARK_BADGE : LIGHT_BADGE)[s.overall_risk] || badge,
                      )}
                    >
                      {s.overall_risk}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <p className={clsx('px-1 text-[10px] leading-snug', dark ? 'text-gray-600' : 'text-slate-400')}>
          Site screening for this coordinate plus nearby context. Not a substitute for a formal flood
          survey or legal due diligence.
        </p>
      </div>
    </div>
  )
}
