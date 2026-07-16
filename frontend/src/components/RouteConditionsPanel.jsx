import React, { useMemo } from 'react'
import clsx from 'clsx'
import GaugeChart from './GaugeChart'
import RainfallChart from './RainfallChart'
import { IconAlertTriangle, IconGauge, IconWaves, IconX } from './Icons'

const TIER_STYLE = {
  Emergency: 'border-red-500/40 bg-red-500/10 text-red-600',
  Warning: 'border-orange-500/40 bg-orange-500/10 text-orange-600',
  Watch: 'border-amber-500/40 bg-amber-500/10 text-amber-600',
  Normal: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600',
  'No mapped warning': 'border-slate-400/30 bg-slate-400/10 text-slate-500',
}

function distanceKm(a, b) {
  const latScale = 111.32
  const lonScale = 111.32 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180)
  return Math.hypot((a.lat - b.lat) * latScale, (a.lon - b.lon) * lonScale)
}

function nearestRouteDistance(station, coordinates) {
  if (!coordinates.length) return Infinity
  // Dense OSRM geometry makes distance to sampled vertices a reliable, fast route proxy.
  return coordinates.reduce((best, coordinate) => Math.min(best, distanceKm(station, {
    lon: Number(coordinate[0]), lat: Number(coordinate[1]),
  })), Infinity)
}

function Section({ title, children, dark }) {
  return <section className={clsx('rounded-xl border p-3', dark ? 'border-gray-800 bg-gray-950/60' : 'border-slate-200 bg-slate-50')}>
    <h3 className={clsx('mb-2 text-[10px] font-semibold uppercase tracking-[0.14em]', dark ? 'text-gray-400' : 'text-slate-600')}>{title}</h3>
    {children}
  </section>
}

export default function RouteConditionsPanel({ navigation, stations = [], liveReadings = {}, theme = 'light', onClose }) {
  const dark = theme === 'dark'
  const settlements = navigation?.database_settlements || []
  const hazards = navigation?.hazards || []
  const reports = navigation?.community_hazards || []
  const weather = navigation?.street_weather || []
  const destination = navigation?.destination?.name || 'Destination'
  const coordinates = navigation?.route?.geometry?.coordinates || []
  const nearbyGauges = useMemo(() => stations
    .map(station => ({ ...station, routeDistanceKm: nearestRouteDistance(station, coordinates) }))
    .filter(station => station.routeDistanceKm <= 50)
    .sort((a, b) => a.routeDistanceKm - b.routeDistanceKm)
    .slice(0, 5), [stations, coordinates])
  const primaryGauge = nearbyGauges[0]
  const rainTotal = weather.reduce((sum, item) => sum + Number(item.rain_mm ?? item.precipitation_mm ?? 0), 0)

  return (
    <section className={clsx('flex h-full flex-col overflow-hidden rounded-none border md:rounded-2xl', dark ? 'border-gray-800 bg-gray-900/95' : 'border-slate-200 bg-white/95')}>
      <header className={clsx('flex items-start justify-between gap-3 border-b p-4', dark ? 'border-gray-800' : 'border-slate-200')}>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-600">Live route flood brief</p>
          <h2 className="mt-1 text-base font-semibold">Flood emergency information</h2>
          <p className={clsx('mt-1 text-xs', dark ? 'text-gray-400' : 'text-slate-500')}>To {destination} · {(navigation.distance_m / 1000).toFixed(1)} km · {Math.round(navigation.duration_s / 60)} min</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close route conditions" className={clsx('rounded-lg border p-2', dark ? 'border-gray-700' : 'border-slate-200')}><IconX size={14} /></button>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <div className={clsx('rounded-xl border p-3', navigation.safe ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-red-500/40 bg-red-500/10')}>
          <p className={clsx('flex items-center gap-2 text-xs font-semibold', navigation.safe ? 'text-emerald-600' : 'text-red-600')}><IconAlertTriangle size={15} />{navigation.safe ? 'No high-risk flood area is currently mapped on this route' : navigation.warning}</p>
          <p className={clsx('mt-2 text-[10px] leading-relaxed', dark ? 'text-gray-300' : 'text-slate-700')}>If water covers the road, turn around. Do not walk or drive through floodwater. Move to higher ground and follow official road closures. For a life-threatening emergency in Nigeria, call <strong>112</strong>.</p>
        </div>

        <Section title="Route conditions now" dark={dark}>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div><p className="text-lg font-semibold text-red-500">{hazards.length}</p><p className="text-[9px] opacity-60">mapped hazards</p></div>
            <div><p className="text-lg font-semibold text-orange-500">{reports.length}</p><p className="text-[9px] opacity-60">recent reports</p></div>
            <div><p className="text-lg font-semibold text-sky-500">{rainTotal.toFixed(1)}</p><p className="text-[9px] opacity-60">mm sampled rain</p></div>
          </div>
          {hazards.slice(0, 4).map(item => <div key={`${item.name}-${item.state}`} className="mt-2 border-t border-current/10 pt-2 text-[10px]"><strong>{item.risk_tier}: {item.name}</strong><span className="opacity-65"> · {item.state} · {Math.round(item.current_distance_m / 1000)} km ahead/nearby</span></div>)}
          {reports.slice(0, 3).map(item => <div key={item.id} className="mt-2 border-t border-current/10 pt-2 text-[10px] text-red-600"><strong>Community report:</strong> {item.affected_street || item.location_name}{item.severity ? ` · ${item.severity}` : ''}</div>)}
        </Section>

        {primaryGauge && <>
          <Section title="Water level along this route" dark={dark}>
            <div className="mb-2 flex items-center justify-between gap-2 text-xs"><span className="flex items-center gap-1.5 font-semibold"><IconWaves size={14} />{primaryGauge.name}</span><span className="text-[10px] text-sky-600">{primaryGauge.routeDistanceKm.toFixed(1)} km from route</span></div>
            <GaugeChart stationId={primaryGauge.id} liveReading={liveReadings[primaryGauge.id]} theme={theme} />
          </Section>
          <Section title="Rainfall affecting this route" dark={dark}>
            <RainfallChart stationId={primaryGauge.id} stationName={primaryGauge.name} theme={theme} />
          </Section>
        </>}

        <Section title={`Nearby gauges (${nearbyGauges.length})`} dark={dark}>
          {nearbyGauges.length ? <div className="space-y-2">{nearbyGauges.map(station => {
            const reading = liveReadings[station.id]
            const percentage = reading && station.bank_full_m ? Math.round(reading.water_level_m / station.bank_full_m * 100) : null
            return <div key={station.id} className={clsx('flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2', dark ? 'border-gray-800' : 'border-slate-200 bg-white')}>
              <div className="min-w-0"><p className="flex items-center gap-1 truncate text-[10px] font-semibold"><IconGauge size={12} />{station.name}</p><p className="text-[9px] opacity-55">{station.river} · {station.routeDistanceKm.toFixed(1)} km from route</p></div>
              <div className="shrink-0 text-right"><p className="text-xs font-semibold text-sky-600">{reading ? `${Number(reading.water_level_m).toFixed(2)} m` : 'No live reading'}</p>{percentage != null && <p className={clsx('text-[9px]', percentage >= 90 ? 'text-red-500' : percentage >= 70 ? 'text-amber-500' : 'text-emerald-500')}>{percentage}% bank-full</p>}</div>
            </div>
          })}</div> : <p className="text-[10px] opacity-60">No gauge was found within 50 km of this route.</p>}
        </Section>

        {weather.length > 0 && <Section title="Rain and weather by road" dark={dark}><div className="space-y-2">{weather.map(item => <div key={`${item.street}-${item.lat}`} className="flex justify-between gap-2 text-[10px]"><strong className="truncate">{item.street}</strong><span className="shrink-0 opacity-65">{item.condition} · {item.rain_mm ?? item.precipitation_mm ?? 0} mm · {item.wind_kmh ?? '—'} km/h wind</span></div>)}</div></Section>}

        <Section title={`Places along the route (${settlements.length})`} dark={dark}>
          {settlements.length ? <ol className="space-y-2">{settlements.map((place, index) => {
            const tier = place.risk_tier || 'No mapped warning'
            return <li key={`${place.name}-${place.route_order}`} className="flex items-start justify-between gap-2 text-[10px]"><span><strong>{index + 1}. {place.name}</strong><span className="opacity-55"> · {place.class}</span></span><span className={clsx('shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-semibold', TIER_STYLE[tier] || TIER_STYLE['No mapped warning'])}>{tier}</span></li>
          })}</ol> : <p className="text-[10px] opacity-60">No named settlement was found within 5 km.</p>}
        </Section>
      </div>
      <p className={clsx('border-t p-3 text-[9px] leading-relaxed', dark ? 'border-gray-800 text-gray-500' : 'border-slate-200 text-slate-400')}>Live advisory only. Conditions can change rapidly; obey emergency services and visible road closures.</p>
    </section>
  )
}
