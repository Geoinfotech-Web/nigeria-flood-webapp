import React, { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { IconAlertTriangle, IconLocate, IconSearch, IconX } from './Icons'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export default function FloodSafeRouting({ theme = 'light', onNavigationChange, inline = false, expert = false }) {
  const dark = theme === 'dark'
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [destination, setDestination] = useState(null)
  const [position, setPosition] = useState(null)
  const [routeInfo, setRouteInfo] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const watchRef = useRef(null)
  const lastRequestRef = useRef(0)
  const lastWarningRef = useRef('')

  const stop = () => {
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current)
    watchRef.current = null
    setPosition(null); setRouteInfo(null); setDestination(null); setResults([]); setError(null)
    onNavigationChange?.(null)
  }

  useEffect(() => () => {
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current)
  }, [])

  const search = async event => {
    event.preventDefault()
    if (query.trim().length < 2) return
    setLoading(true); setError(null)
    try {
      const response = await fetch(`${API}/geocode/search?q=${encodeURIComponent(query.trim())}&limit=5`)
      if (!response.ok) throw new Error('Destination search is unavailable.')
      setResults(await response.json())
    } catch (err) { setError(err.message) } finally { setLoading(false) }
  }

  const start = place => {
    if (!navigator.geolocation) return setError('GPS is not supported by this browser.')
    setDestination(place); setResults([]); setQuery(place.display_name || place.name); setError(null)
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current)
    watchRef.current = navigator.geolocation.watchPosition(
      ({ coords }) => setPosition({ lat: coords.latitude, lon: coords.longitude, accuracy: coords.accuracy }),
      () => setError('Enable location access to receive live flood-route cautions.'),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 },
    )
  }

  useEffect(() => {
    if (!position || !destination) return
    const now = Date.now()
    if (now - lastRequestRef.current < 8000) return
    lastRequestRef.current = now
    setLoading(true)
    fetch(`${API}/routing/route?start_lat=${position.lat}&start_lon=${position.lon}&end_lat=${destination.lat}&end_lon=${destination.lon}`)
      .then(async response => {
        if (!response.ok) throw new Error((await response.json()).detail || 'A route could not be calculated.')
        return response.json()
      })
      .then(data => {
        setRouteInfo(data); setError(null)
        onNavigationChange?.({ ...data, current: position, destination })
        if (data.warning && data.warning !== lastWarningRef.current) {
          lastWarningRef.current = data.warning
          if ('speechSynthesis' in window) window.speechSynthesis.speak(new SpeechSynthesisUtterance(`Caution. ${data.warning} Consider another route.`))
        }
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [position, destination, onNavigationChange])

  return <div className={inline ? 'relative z-50' : 'absolute right-3 top-3 z-20'}>
    {!open ? <button type="button" onClick={() => setOpen(true)} className={clsx('inline-flex items-center gap-1.5 border border-sky-400/40 bg-sky-600 font-semibold text-white shadow-lg hover:bg-sky-500', inline ? 'rounded-md px-2 py-1 text-[10px]' : 'rounded-xl px-3 py-2 text-[11px]')}><IconLocate size={inline ? 10 : 12} />Safe route</button> :
    <section className={clsx('w-[min(21rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border shadow-2xl', inline && 'absolute right-0 top-full mt-2', dark ? 'border-gray-700 bg-gray-950/95 text-gray-100' : 'border-slate-200 bg-white/95 text-slate-900')}>
      <header className={clsx('flex items-center justify-between border-b px-3 py-2.5', dark ? 'border-gray-800' : 'border-slate-200')}><div><h2 className="text-xs font-semibold">Flood-aware live route</h2><p className={clsx('text-[9px]', dark ? 'text-gray-500' : 'text-slate-500')}>GPS cautions near mapped flood-prone areas</p></div><button type="button" onClick={() => { stop(); setOpen(false) }}><IconX size={13} /></button></header>
      <div className="space-y-2 p-3">
        <form onSubmit={search} className="flex gap-2"><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Where are you going?" className={clsx('min-w-0 flex-1 rounded-lg border px-2.5 py-2 text-xs outline-none focus:border-sky-500', dark ? 'border-gray-700 bg-gray-900' : 'border-slate-200 bg-white')} /><button disabled={loading} className="rounded-lg bg-sky-600 px-3 text-white hover:bg-sky-500"><IconSearch size={13} /></button></form>
        {results.length > 0 && <div className={clsx('max-h-36 overflow-y-auto rounded-lg border', dark ? 'border-gray-800' : 'border-slate-200')}>{results.map(place => <button key={`${place.lat}-${place.lon}`} type="button" onClick={() => start(place)} className={clsx('block w-full border-b px-3 py-2 text-left text-[10px] last:border-0', dark ? 'border-gray-800 hover:bg-gray-900' : 'border-slate-100 hover:bg-slate-50')}><strong className="block text-[11px]">{place.name}</strong>{place.display_name}</button>)}</div>}
        {destination && <div className={clsx('rounded-lg border p-2.5 text-[10px]', routeInfo?.safe ? 'border-emerald-500/30 bg-emerald-500/10' : routeInfo?.warning ? 'border-red-500/40 bg-red-500/10' : dark ? 'border-gray-700' : 'border-slate-200')}>
          <p className="font-semibold">To: {destination.name}</p>
          {position && <p className="mt-1 text-[9px] opacity-70">Live GPS active · accuracy ±{Math.round(position.accuracy)} m</p>}
          {routeInfo && <p className="mt-1">{(routeInfo.distance_m / 1000).toFixed(1)} km · {Math.round(routeInfo.duration_s / 60)} min</p>}
          {routeInfo?.safe && <p className="mt-2 font-semibold text-emerald-500">No mapped high-risk areas found along this route.</p>}
          {routeInfo?.warning && <p className="mt-2 flex gap-1.5 font-semibold text-red-500"><IconAlertTriangle size={12} />{routeInfo.warning}</p>}
          {routeInfo?.community_hazards?.length > 0 && <div className="mt-2 space-y-1 border-t border-red-500/20 pt-2">{routeInfo.community_hazards.slice(0, 4).map(report => <p key={report.id} className="text-[9px] text-red-500"><strong>{report.affected_street}</strong>{report.flood_source ? ` · ${report.flood_source}` : ''}</p>)}</div>}
          {(routeInfo?.database_streets?.length > 0 || routeInfo?.database_settlements?.length > 0) && <div className={clsx('mt-2 border-t pt-2', dark ? 'border-gray-700' : 'border-slate-200')}><p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-sky-600">Route from local database</p>{routeInfo.database_streets?.length > 0 && <p className={clsx('text-[8px] leading-relaxed', dark ? 'text-gray-300' : 'text-slate-600')}><strong>Streets:</strong> {routeInfo.database_streets.map(item => item.name).join(' → ')}</p>}{routeInfo.database_settlements?.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{routeInfo.database_settlements.map(place => <span key={`${place.name}-${place.route_order}`} className={clsx('rounded-full border px-1.5 py-0.5 text-[8px]', dark ? 'border-gray-700 bg-gray-900' : 'border-slate-200 bg-white')}><strong>{place.name}</strong> · {place.class}</span>)}</div>}</div>}
          {expert && routeInfo?.street_weather?.length > 0 && <div className={clsx('mt-2 border-t pt-2', dark ? 'border-gray-700' : 'border-slate-200')}><p className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-sky-600">Street weather report</p><div className="max-h-32 space-y-1 overflow-y-auto">{routeInfo.street_weather.map(item => <div key={`${item.street}-${item.lat}`} className={clsx('rounded-md px-2 py-1.5', dark ? 'bg-gray-900' : 'bg-white')}><p className="truncate text-[9px] font-semibold">{item.street}</p><p className={clsx('text-[8px]', dark ? 'text-gray-400' : 'text-slate-500')}>{item.condition} · {item.temperature_c ?? '—'}°C · Rain {item.precipitation_mm ?? 0} mm · Wind {item.wind_kmh ?? '—'} km/h</p></div>)}</div></div>}
          <button type="button" onClick={stop} className="mt-2 rounded-md bg-slate-700 px-2 py-1 text-[9px] font-semibold text-white">Stop navigation</button>
        </div>}
        {loading && <p className="text-[10px] text-sky-600">Updating route…</p>}
        {error && <p className="rounded-lg bg-red-500/10 p-2 text-[10px] text-red-500">{error}</p>}
        <p className={clsx('text-[8px] leading-relaxed', dark ? 'text-gray-600' : 'text-slate-400')}>Advisory only. Never enter visible floodwater; obey official closures and emergency instructions.</p>
      </div>
    </section>}
  </div>
}
