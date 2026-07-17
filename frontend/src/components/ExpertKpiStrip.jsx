import React, { useMemo } from 'react'
import clsx from 'clsx'
import { formatPopulation } from '../lib/stationRisk'

const ZONE_SEVERITY = {
  'Highly Likely': 6,
  'Very High': 5,
  Emergency: 4,
  Likely: 3,
  High: 3,
  Warning: 2,
  Moderate: 2,
  Watch: 1,
  Normal: 0,
}

const TIER_ACCENT = {
  'Highly Likely': {
    dark: 'border-fuchsia-800/50 bg-fuchsia-950/40',
    light: 'border-fuchsia-200 bg-fuchsia-50',
    valueDark: 'text-fuchsia-300',
    valueLight: 'text-fuchsia-900',
    bar: 'bg-fuchsia-600',
  },
  'Very High': {
    dark: 'border-indigo-800/50 bg-indigo-950/40',
    light: 'border-indigo-200 bg-indigo-50',
    valueDark: 'text-indigo-300',
    valueLight: 'text-indigo-900',
    bar: 'bg-indigo-600',
  },
  Emergency: {
    dark: 'border-red-800/50 bg-red-950/40',
    light: 'border-red-200 bg-red-50',
    valueDark: 'text-red-300',
    valueLight: 'text-red-800',
    bar: 'bg-red-500',
  },
  Likely: {
    dark: 'border-orange-800/50 bg-orange-950/40',
    light: 'border-orange-200 bg-orange-50',
    valueDark: 'text-orange-300',
    valueLight: 'text-orange-800',
    bar: 'bg-orange-500',
  },
  High: {
    dark: 'border-blue-800/50 bg-blue-950/40',
    light: 'border-blue-200 bg-blue-50',
    valueDark: 'text-blue-300',
    valueLight: 'text-blue-800',
    bar: 'bg-blue-500',
  },
  Warning: {
    dark: 'border-orange-800/50 bg-orange-950/40',
    light: 'border-orange-200 bg-orange-50',
    valueDark: 'text-orange-300',
    valueLight: 'text-orange-800',
    bar: 'bg-orange-500',
  },
  Moderate: {
    dark: 'border-sky-800/50 bg-sky-950/40',
    light: 'border-sky-200 bg-sky-50',
    valueDark: 'text-sky-300',
    valueLight: 'text-sky-800',
    bar: 'bg-sky-500',
  },
  Normal: {
    dark: 'border-emerald-800/50 bg-emerald-950/35',
    light: 'border-emerald-200 bg-emerald-50',
    valueDark: 'text-emerald-300',
    valueLight: 'text-emerald-800',
    bar: 'bg-emerald-500',
  },
}

const CARD_ACCENT = {
  states: { dark: 'border-sky-800/40 bg-sky-950/30', light: 'border-sky-200 bg-sky-50', valueDark: 'text-sky-300', valueLight: 'text-sky-800', bar: 'bg-sky-500' },
  settlements: { dark: 'border-amber-800/40 bg-amber-950/30', light: 'border-amber-200 bg-amber-50', valueDark: 'text-amber-300', valueLight: 'text-amber-800', bar: 'bg-amber-500' },
  urban: { dark: 'border-fuchsia-800/40 bg-fuchsia-950/30', light: 'border-fuchsia-200 bg-fuchsia-50', valueDark: 'text-fuchsia-300', valueLight: 'text-fuchsia-900', bar: 'bg-fuchsia-600' },
  roads: { dark: 'border-violet-800/40 bg-violet-950/30', light: 'border-violet-200 bg-violet-50', valueDark: 'text-violet-300', valueLight: 'text-violet-800', bar: 'bg-violet-500' },
  rain: { dark: 'border-cyan-800/40 bg-cyan-950/30', light: 'border-cyan-200 bg-cyan-50', valueDark: 'text-cyan-300', valueLight: 'text-cyan-800', bar: 'bg-cyan-500' },
}

function worstZoneTier(zones = {}) {
  let best = 'Normal'
  let bestRank = -1
  for (const [tier, count] of Object.entries(zones)) {
    if (!count) continue
    const rank = ZONE_SEVERITY[tier] ?? 0
    if (rank > bestRank) {
      bestRank = rank
      best = tier
    }
  }
  return best
}

function KpiCard({ label, value, detail, accent, theme }) {
  const dark = theme === 'dark'
  return (
    <div
      className={clsx(
        'relative min-w-[9.5rem] flex-1 overflow-hidden rounded-xl border px-3 py-2 shadow-sm',
        dark ? accent.dark : accent.light,
      )}
    >
      <div className={clsx('absolute inset-y-0 left-0 w-1', accent.bar)} aria-hidden />
      <p
        className={clsx(
          'pl-1.5 text-[9px] font-semibold uppercase tracking-[0.12em]',
          dark ? 'text-gray-400' : 'text-slate-500',
        )}
      >
        {label}
      </p>
      <p
        className={clsx(
          'mt-0.5 pl-1.5 font-display text-xl font-semibold tabular-nums leading-none tracking-tight sm:text-2xl',
          dark ? accent.valueDark : accent.valueLight,
        )}
      >
        {value}
      </p>
      {detail ? (
        <p
          className={clsx(
            'mt-1 truncate pl-1.5 text-[10px] leading-tight',
            dark ? 'text-gray-500' : 'text-slate-500',
          )}
          title={typeof detail === 'string' ? detail : undefined}
        >
          {detail}
        </p>
      ) : null}
    </div>
  )
}

export default function ExpertKpiStrip({
  impactSummary = null,
  urbanFlashSummary = null,
  rainfallAvgMm = null,
  theme = 'light',
}) {
  const dark = theme === 'dark'

  const urban = urbanFlashSummary || impactSummary?.urban_flash
  const highly = urban?.highly_likely ?? 0
  const likely = urban?.likely ?? 0

  const impactStates = impactSummary?.states || []
  const settlements = impactSummary?.settlements?.total ?? '—'
  const towns =
    (impactSummary?.settlements?.by_class?.Town || 0) +
    (impactSummary?.settlements?.by_class?.Village || 0)
  const pop = formatPopulation(impactSummary?.settlements?.total_population)
  const roads = impactSummary?.roads?.total ?? '—'
  const roadKm = impactSummary?.roads?.total_length_km

  const worstTier = useMemo(() => {
    const fromZones = worstZoneTier(impactSummary?.zones)
    // If impact-summary hasn't loaded (or failed), still surface urban flash severity.
    if (highly > 0 && (ZONE_SEVERITY['Highly Likely'] || 0) >= (ZONE_SEVERITY[fromZones] || 0)) {
      return 'Highly Likely'
    }
    if (likely > 0 && fromZones === 'Normal') return 'Likely'
    return fromZones
  }, [impactSummary?.zones, highly, likely])

  const rainValue =
    rainfallAvgMm != null && Number.isFinite(rainfallAvgMm)
      ? `${Math.round(rainfallAvgMm)} mm`
      : '—'

  const riskDetail = impactStates.length
    ? `Towns/villages in flood zones · ${impactStates.length} state${impactStates.length === 1 ? '' : 's'}`
    : 'Inundation probability + urban flash'

  return (
    <div
      className={clsx(
        'shrink-0 border-b px-3 py-2',
        dark ? 'border-gray-800 bg-gray-950/80' : 'border-slate-200 bg-white/90',
      )}
    >
      <div className="flex gap-2 overflow-x-auto pb-0.5 scrollbar-none">
        <KpiCard
          theme={theme}
          label="Current Risk Level"
          value={String(worstTier).toUpperCase()}
          detail={riskDetail}
          accent={TIER_ACCENT[worstTier] || TIER_ACCENT.Normal}
        />
        <KpiCard
          theme={theme}
          label="Affected States"
          value={`${impactStates.length} / 36`}
          detail={
            impactStates.slice(0, 4).join(', ') ||
            'States with towns/villages in flood extents'
          }
          accent={CARD_ACCENT.states}
        />
        <KpiCard
          theme={theme}
          label="Settlements at Risk"
          value={typeof settlements === 'number' ? settlements.toLocaleString() : settlements}
          detail={
            pop
              ? `${pop} pop · ${towns} towns/villages`
              : towns
                ? `${towns} towns/villages exposed`
                : 'In inundation / urban flash zones'
          }
          accent={CARD_ACCENT.settlements}
        />
        <KpiCard
          theme={theme}
          label="Urban Flash Flood"
          value={`${highly + likely}`}
          detail={`${highly} highly likely · ${likely} likely`}
          accent={CARD_ACCENT.urban}
        />
        <KpiCard
          theme={theme}
          label="Roads at Risk"
          value={typeof roads === 'number' ? roads.toLocaleString() : roads}
          detail={
            roadKm != null
              ? `${Number(roadKm).toLocaleString()} km length`
              : 'Intersecting flood extents'
          }
          accent={CARD_ACCENT.roads}
        />
        <KpiCard
          theme={theme}
          label="Rainfall (24h)"
          value={rainValue}
          detail="National average (daily)"
          accent={CARD_ACCENT.rain}
        />
      </div>
    </div>
  )
}
