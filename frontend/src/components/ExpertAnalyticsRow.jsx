import React, { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { IconChevronDown, IconChevronUp } from './Icons'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const TIER_COLORS = {
  Normal: '#22c55e',
  Watch: '#eab308',
  Warning: '#f97316',
  Emergency: '#ef4444',
  Likely: '#f97316',
  'Highly Likely': '#86198f',
}

function timeAgo(value) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`
  return `${Math.floor(minutes / 1440)}d ago`
}

function PanelShell({ title, theme, children, action = null }) {
  const dark = theme === 'dark'
  return (
    <div
      className={clsx(
        'flex min-h-0 flex-col overflow-hidden rounded-xl border',
        dark ? 'border-gray-800 bg-gray-900/70' : 'border-slate-200 bg-white',
      )}
    >
      <div
        className={clsx(
          'flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2',
          dark ? 'border-gray-800' : 'border-slate-100',
        )}
      >
        <p
          className={clsx(
            'text-[10px] font-semibold uppercase tracking-widest',
            dark ? 'text-gray-500' : 'text-slate-500',
          )}
        >
          {title}
        </p>
        {action}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-2.5">{children}</div>
    </div>
  )
}

/** Rank states by highest live gauge water level and by 24h rainfall. */
function StateRankPanel({ stations, liveReadings, theme }) {
  const dark = theme === 'dark'
  const [rainByState, setRainByState] = useState([])

  useEffect(() => {
    const load = () =>
      fetch(`${API}/rainfall/by-state?days=1`)
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => setRainByState(Array.isArray(data) ? data : []))
        .catch(() => setRainByState([]))
    load()
    const id = setInterval(load, 300_000)
    return () => clearInterval(id)
  }, [])

  const byWater = useMemo(() => {
    const map = {}
    for (const s of stations) {
      const state = s.state || 'Unknown'
      const level = liveReadings[s.id]?.water_level_m
      if (level == null) continue
      const n = Number(level)
      if (!Number.isFinite(n)) continue
      if (!map[state] || n > map[state].level) {
        map[state] = { state, level: n, station: s.name, stationId: s.id }
      }
    }
    return Object.values(map)
      .sort((a, b) => b.level - a.level)
      .slice(0, 5)
  }, [stations, liveReadings])

  const byRain = useMemo(
    () => [...rainByState].sort((a, b) => b.avg_rain_mm - a.avg_rain_mm).slice(0, 5),
    [rainByState],
  )

  return (
    <PanelShell title="States · Water & Rain" theme={theme}>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className={clsx('mb-1 text-[9px] font-semibold uppercase', dark ? 'text-sky-400' : 'text-sky-700')}>
            Highest water level
          </p>
          <ul className="space-y-1">
            {byWater.length === 0 && (
              <li className={clsx('text-[10px]', dark ? 'text-gray-600' : 'text-slate-400')}>No readings</li>
            )}
            {byWater.map((row, i) => (
              <li
                key={row.state}
                className={clsx(
                  'rounded-md border px-1.5 py-1',
                  dark ? 'border-gray-800 bg-gray-950/40' : 'border-slate-100 bg-slate-50',
                )}
              >
                <div className="flex items-baseline justify-between gap-1">
                  <span className={clsx('truncate text-[10px] font-medium', dark ? 'text-gray-200' : 'text-slate-800')}>
                    {i + 1}. {row.state}
                  </span>
                  <span className={clsx('shrink-0 text-[10px] tabular-nums font-semibold', dark ? 'text-sky-300' : 'text-sky-800')}>
                    {row.level.toFixed(2)} m
                  </span>
                </div>
                <p className={clsx('truncate text-[9px]', dark ? 'text-gray-500' : 'text-slate-500')}>
                  {row.station}
                </p>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className={clsx('mb-1 text-[9px] font-semibold uppercase', dark ? 'text-cyan-400' : 'text-cyan-700')}>
            Highest rainfall (24h)
          </p>
          <ul className="space-y-1">
            {byRain.length === 0 && (
              <li className={clsx('text-[10px]', dark ? 'text-gray-600' : 'text-slate-400')}>No rainfall data</li>
            )}
            {byRain.map((row, i) => (
              <li
                key={row.state}
                className={clsx(
                  'rounded-md border px-1.5 py-1',
                  dark ? 'border-gray-800 bg-gray-950/40' : 'border-slate-100 bg-slate-50',
                )}
              >
                <div className="flex items-baseline justify-between gap-1">
                  <span className={clsx('truncate text-[10px] font-medium', dark ? 'text-gray-200' : 'text-slate-800')}>
                    {i + 1}. {row.state}
                  </span>
                  <span className={clsx('shrink-0 text-[10px] tabular-nums font-semibold', dark ? 'text-cyan-300' : 'text-cyan-800')}>
                    {row.avg_rain_mm.toFixed(0)} mm
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </PanelShell>
  )
}

function FloodNewsPanel({ theme }) {
  const dark = theme === 'dark'
  const [articles, setArticles] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = () =>
      fetch(`${API}/news?limit=5`, { cache: 'no-store' })
        .then((response) => (response.ok ? response.json() : { articles: [] }))
        .then((data) => setArticles(Array.isArray(data.articles) ? data.articles : []))
        .catch(() => setArticles([]))
        .finally(() => setLoading(false))
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [])

  return (
    <PanelShell title="Flood News Reports" theme={theme}>
      <ul className="max-h-[140px] space-y-1.5 overflow-y-auto">
        {loading && (
          <li className={clsx('py-6 text-center text-[11px]', dark ? 'text-gray-600' : 'text-slate-400')}>
            Loading flood news…
          </li>
        )}
        {!loading && articles.length === 0 && (
          <li className={clsx('py-6 text-center text-[11px]', dark ? 'text-gray-600' : 'text-slate-400')}>
            No recent flood news
          </li>
        )}
        {articles.map((article) => (
          <li key={article.url}>
            <a
              href={article.url}
              target="_blank"
              rel="noreferrer"
              className={clsx(
                'block rounded-lg border px-2 py-1.5 transition',
                dark
                  ? 'border-gray-800 bg-gray-950/40 hover:border-sky-700 hover:bg-gray-900'
                  : 'border-slate-100 bg-slate-50 hover:border-sky-300 hover:bg-white',
              )}
            >
              <p className={clsx('line-clamp-2 text-[10px] font-medium leading-snug', dark ? 'text-gray-100' : 'text-slate-800')}>
                {article.title}
              </p>
              <p className={clsx('mt-1 flex justify-between gap-2 text-[9px]', dark ? 'text-gray-500' : 'text-slate-500')}>
                <span className="truncate text-sky-500">{article.source}</span>
                <span className="shrink-0">{timeAgo(article.published_at)}</span>
              </p>
            </a>
          </li>
        ))}
      </ul>
    </PanelShell>
  )
}

function UrbanFlashPanel({ urbanFlash, theme, onSelectArea }) {
  const dark = theme === 'dark'
  const areas = urbanFlash?.top_areas || []

  return (
    <PanelShell title="Urban Flash · Likely / Highly Likely" theme={theme}>
      <div className="mb-1.5 flex gap-2 text-[10px]">
        <span className={dark ? 'text-fuchsia-300' : 'text-fuchsia-800'}>
          {urbanFlash?.highly_likely ?? 0} highly likely
        </span>
        <span className={dark ? 'text-orange-300' : 'text-orange-700'}>
          {urbanFlash?.likely ?? 0} likely
        </span>
      </div>
      <ul className="max-h-[118px] space-y-1 overflow-y-auto">
        {areas.length === 0 && (
          <li className={clsx('py-6 text-center text-[11px]', dark ? 'text-gray-600' : 'text-slate-400')}>
            No urban flash zones
          </li>
        )}
        {areas.map((a, idx) => {
          const color = TIER_COLORS[a.risk_tier] || '#64748b'
          return (
            <li key={`${a.name}-${a.state}-${idx}`}>
              <button
                type="button"
                onClick={() => onSelectArea?.(a)}
                className={clsx(
                  'flex w-full items-start gap-2 rounded-lg border px-2 py-1.5 text-left transition',
                  dark
                    ? 'border-gray-800 bg-gray-950/40 hover:border-gray-700 hover:bg-gray-900/70'
                    : 'border-slate-100 bg-slate-50 hover:border-slate-300 hover:bg-white',
                )}
              >
                <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                <span className="min-w-0 flex-1">
                  <span className={clsx('block truncate text-[11px] font-medium', dark ? 'text-gray-100' : 'text-slate-800')}>
                    {a.name}
                  </span>
                  <span className={clsx('text-[10px]', dark ? 'text-gray-500' : 'text-slate-500')}>
                    {a.risk_tier}
                    {a.state ? ` · ${a.state}` : ''}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </PanelShell>
  )
}

function AlertsPanel({ theme, onSelectStation, stations }) {
  const dark = theme === 'dark'
  const [alerts, setAlerts] = useState([])

  useEffect(() => {
    const load = () =>
      fetch(`${API}/alerts?limit=8`)
        .then((r) => (r.ok ? r.json() : []))
        .then((data) =>
          setAlerts(
            (Array.isArray(data) ? data : []).filter((a) => a.risk_tier && a.risk_tier !== 'Normal'),
          ),
        )
        .catch(() => setAlerts([]))
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [])

  const stationByCode = useMemo(() => {
    const map = {}
    for (const s of stations) map[s.code] = s
    return map
  }, [stations])

  return (
    <PanelShell title="Recent Alerts" theme={theme}>
      <ul className="max-h-[140px] space-y-1.5 overflow-y-auto">
        {alerts.length === 0 && (
          <li className={clsx('py-6 text-center text-[11px]', dark ? 'text-gray-600' : 'text-slate-400')}>
            No elevated alerts
          </li>
        )}
        {alerts.map((a) => {
          const color = TIER_COLORS[a.risk_tier] || '#64748b'
          const station = stationByCode[a.station_code]
          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => station && onSelectStation?.(station.id)}
                className={clsx(
                  'flex w-full items-start gap-2 rounded-lg border px-2 py-1.5 text-left transition',
                  dark
                    ? 'border-gray-800 bg-gray-950/40 hover:border-gray-700'
                    : 'border-slate-100 bg-slate-50 hover:border-slate-300',
                )}
              >
                <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                <span className="min-w-0 flex-1">
                  <span className={clsx('block truncate text-[11px] font-medium', dark ? 'text-gray-100' : 'text-slate-800')}>
                    {a.risk_tier} — {a.station_name || a.station_code}
                  </span>
                  <span className={clsx('text-[10px]', dark ? 'text-gray-500' : 'text-slate-500')}>
                    {timeAgo(a.created_at)}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </PanelShell>
  )
}

function CommunityReportsPanel({ theme, onViewAll }) {
  const dark = theme === 'dark'
  const [reports, setReports] = useState([])
  const severityColor = {
    Low: 'bg-emerald-500',
    Moderate: 'bg-amber-400',
    High: 'bg-orange-500',
    Critical: 'bg-red-500',
  }

  useEffect(() => {
    const load = () =>
      fetch(`${API}/incidents?limit=5`)
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => setReports(Array.isArray(data) ? data : []))
        .catch(() => setReports([]))
    load()
    const id = setInterval(load, 20_000)
    return () => clearInterval(id)
  }, [])

  return (
    <PanelShell
      title="Community Reports"
      theme={theme}
      action={
        <button
          type="button"
          onClick={onViewAll}
          className={clsx(
            'text-[10px] font-semibold',
            dark ? 'text-sky-400 hover:text-sky-300' : 'text-sky-700 hover:text-sky-900',
          )}
        >
          View all
        </button>
      }
    >
      <ul className="max-h-[140px] space-y-1.5 overflow-y-auto">
        {reports.length === 0 && (
          <li className={clsx('py-6 text-center text-[11px]', dark ? 'text-gray-600' : 'text-slate-400')}>
            No community reports yet
          </li>
        )}
        {reports.map((r) => (
          <li key={r.id}>
          <button
            type="button"
            onClick={() => onViewAll?.(r)}
            className={clsx(
              'flex w-full gap-2 rounded-lg border px-2 py-1.5 text-left transition',
              dark ? 'border-gray-800 bg-gray-950/40 hover:border-sky-700 hover:bg-gray-900' : 'border-slate-100 bg-slate-50 hover:border-sky-300 hover:bg-white',
            )}
          >
            {r.media_url && r.media_type === 'image' ? (
              <img
                src={r.media_url.startsWith('http') ? r.media_url : `${API}${r.media_url}`}
                alt=""
                className="h-10 w-10 shrink-0 rounded object-cover"
              />
            ) : (
              <div
                className={clsx(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded text-[10px]',
                  dark ? 'bg-gray-800 text-gray-500' : 'bg-slate-200 text-slate-500',
                )}
              >
                —
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className={clsx('h-1.5 w-1.5 rounded-full', severityColor[r.severity] || 'bg-slate-400')} />
                <span className={clsx('truncate text-[11px] font-medium', dark ? 'text-gray-100' : 'text-slate-800')}>
                  {r.incident_type} — {r.location_name || 'Unknown'}
                </span>
              </div>
              <p className={clsx('mt-0.5 text-[10px]', dark ? 'text-gray-500' : 'text-slate-500')}>
                {r.severity} · {r.status || 'unverified'} · {timeAgo(r.created_at)}
              </p>
            </div>
          </button>
          </li>
        ))}
      </ul>
    </PanelShell>
  )
}

export default function ExpertAnalyticsRow({
  stations = [],
  liveReadings = {},
  impactSummary = null,
  urbanFlashSummary = null,
  theme = 'light',
  onSelectStation,
  onSelectUrbanFlash,
  onViewReports,
  collapsed = false,
  onToggleCollapsed,
}) {
  const dark = theme === 'dark'
  const urbanFlash = urbanFlashSummary || impactSummary?.urban_flash

  return (
    <div
      className={clsx(
        'hidden shrink-0 border-t lg:block',
        dark ? 'border-gray-800 bg-gray-950/60' : 'border-slate-200 bg-slate-50/80',
      )}
    >
      <div className="flex items-center justify-between px-3 py-1.5">
        <p
          className={clsx(
            'text-[10px] font-semibold uppercase tracking-widest',
            dark ? 'text-gray-500' : 'text-slate-500',
          )}
        >
          Network analytics
        </p>
        <button
          type="button"
          onClick={onToggleCollapsed}
          className={clsx(
            'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium',
            dark ? 'text-gray-400 hover:bg-gray-800' : 'text-slate-500 hover:bg-slate-200',
          )}
        >
          {collapsed ? 'Expand' : 'Collapse'}
          {collapsed ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />}
        </button>
      </div>
      {!collapsed && (
        <div className="grid grid-cols-4 gap-2 px-3 pb-2.5">
          <FloodNewsPanel theme={theme} />
          <UrbanFlashPanel urbanFlash={urbanFlash} theme={theme} onSelectArea={onSelectUrbanFlash} />
          <AlertsPanel theme={theme} onSelectStation={onSelectStation} stations={stations} />
          <CommunityReportsPanel theme={theme} onViewAll={onViewReports} />
        </div>
      )}
    </div>
  )
}
