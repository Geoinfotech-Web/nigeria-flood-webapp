import React, { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { RISK_COLOR, RISK_LABEL, RISK_ORDER } from '../lib/riskCopy'
import { IconNewspaper } from './Icons'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const LIST_OPTIONS = [
  { id: 'places', label: 'Nationwide places affected' },
  { id: 'news', label: 'News report' },
  { id: 'community', label: 'Community report' },
]

const RISK_FILL = {
  Emergency: '#ef4444',
  Warning: '#f97316',
  Watch: '#eab308',
}

const SEVERITY_DOT = {
  Critical: 'bg-red-500',
  High: 'bg-orange-500',
  Moderate: 'bg-yellow-500',
  Low: 'bg-emerald-500',
}

const SEVERITY_ORDER = {
  Critical: 4,
  High: 3,
  Moderate: 2,
  Low: 1,
}

function RiskPoint({ tier, size = 10 }) {
  const fill = RISK_FILL[tier] || RISK_FILL.Warning
  return (
    <span
      className="shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: fill,
        border: '1.5px solid #000000',
        boxSizing: 'border-box',
      }}
      aria-hidden
    />
  )
}

function relativeTime(value) {
  if (!value) return 'recent'
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000))
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`
  return `${Math.floor(minutes / 1440)}d ago`
}

function toTime(value) {
  const t = new Date(value || 0).getTime()
  return Number.isFinite(t) ? t : 0
}

function selectClass(dark) {
  return clsx(
    'min-w-0 flex-1 rounded-md border px-1.5 py-1 text-[10px] font-medium',
    dark
      ? 'border-gray-700 bg-gray-950 text-gray-200'
      : 'border-slate-200 bg-white text-slate-700',
  )
}

function FilterBar({ theme, children }) {
  const dark = theme === 'dark'
  return (
    <div
      className={clsx(
        'flex shrink-0 flex-wrap gap-1.5 border-b px-2 py-1.5',
        dark ? 'border-gray-800' : 'border-slate-100',
      )}
    >
      {children}
    </div>
  )
}

function PanelShell({ title, subtitle, count, theme, className, filters, children }) {
  const dark = theme === 'dark'
  return (
    <section
      className={clsx(
        'flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border',
        dark ? 'border-gray-800 bg-gray-950/90' : 'border-slate-200 bg-white',
        className,
      )}
    >
      <header
        className={clsx(
          'shrink-0 border-b px-3 py-2',
          dark ? 'border-gray-800' : 'border-slate-100',
        )}
      >
        <div className="flex items-baseline justify-between gap-2">
          <h3
            className={clsx(
              'text-[11px] font-semibold uppercase tracking-wide',
              dark ? 'text-gray-200' : 'text-slate-800',
            )}
          >
            {title}
          </h3>
          {count != null && (
            <span className={clsx('tabular-nums text-[10px]', dark ? 'text-gray-500' : 'text-slate-400')}>
              {count}
            </span>
          )}
        </div>
        {subtitle ? (
          <p className={clsx('mt-0.5 text-[10px]', dark ? 'text-gray-500' : 'text-slate-500')}>
            {subtitle}
          </p>
        ) : null}
      </header>
      {filters}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">{children}</div>
    </section>
  )
}

function EmptyState({ theme, children }) {
  return (
    <p
      className={clsx(
        'px-2 py-8 text-center text-[11px]',
        theme === 'dark' ? 'text-gray-500' : 'text-slate-400',
      )}
    >
      {children}
    </p>
  )
}

/**
 * Public-mode browse lists with per-list filter/sort controls.
 */
export default function PublicListsDock({
  theme = 'light',
  placesSummary = null,
  placesLoading = false,
  onSelectPlace,
  onFocusNews,
  onFocusCommunityReport,
  onNewsArticles,
  active,
  onActiveChange,
}) {
  const dark = theme === 'dark'
  const [newsArticles, setNewsArticles] = useState([])
  const [newsLoading, setNewsLoading] = useState(false)
  const [newsUnavailable, setNewsUnavailable] = useState(false)
  const [communityReports, setCommunityReports] = useState([])
  const [communityLoading, setCommunityLoading] = useState(false)

  const [placesFilter, setPlacesFilter] = useState({ risk: 'All', placeClass: 'All', sort: 'risk' })
  const [newsFilter, setNewsFilter] = useState({ located: 'All', sort: 'newest', date: 'All' })
  const [communityFilter, setCommunityFilter] = useState({
    severity: 'All',
    status: 'All',
    sort: 'newest',
  })

  const places = placesSummary?.places || []
  const openCount = LIST_OPTIONS.filter((opt) => active[opt.id]).length

  const toggle = (id) => {
    onActiveChange?.({ ...active, [id]: !active[id] })
  }

  const loadNews = useCallback(async () => {
    setNewsLoading(true)
    try {
      const response = await fetch(`${API}/news?limit=20`, { cache: 'no-store' })
      if (!response.ok) throw new Error('News request failed')
      const data = await response.json()
      const next = data.articles || []
      setNewsArticles(next)
      setNewsUnavailable(Boolean(data.unavailable))
      onNewsArticles?.(next)
    } catch {
      setNewsUnavailable(true)
    } finally {
      setNewsLoading(false)
    }
  }, [onNewsArticles])

  const loadCommunity = useCallback(async () => {
    setCommunityLoading(true)
    try {
      const response = await fetch(`${API}/incidents?limit=40`, { cache: 'no-store' })
      if (!response.ok) throw new Error('Incidents request failed')
      setCommunityReports(await response.json())
    } catch {
      setCommunityReports([])
    } finally {
      setCommunityLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!active.news) return undefined
    loadNews()
    const timer = setInterval(loadNews, 60_000)
    return () => clearInterval(timer)
  }, [active.news, loadNews])

  useEffect(() => {
    if (!active.community) return undefined
    loadCommunity()
    const timer = setInterval(loadCommunity, 20_000)
    const onChanged = () => loadCommunity()
    window.addEventListener('flood-reports-changed', onChanged)
    return () => {
      clearInterval(timer)
      window.removeEventListener('flood-reports-changed', onChanged)
    }
  }, [active.community, loadCommunity])

  const filteredPlaces = useMemo(() => {
    let rows = [...places]
    if (placesFilter.risk !== 'All') {
      rows = rows.filter((p) => (p.station_risk_tier || 'Warning') === placesFilter.risk)
    }
    if (placesFilter.placeClass !== 'All') {
      rows = rows.filter((p) => (p.class || 'Town') === placesFilter.placeClass)
    }
    rows.sort((a, b) => {
      if (placesFilter.sort === 'name') {
        return (a.name || '').localeCompare(b.name || '')
      }
      if (placesFilter.sort === 'state') {
        const byState = (a.state || '').localeCompare(b.state || '')
        return byState || (a.name || '').localeCompare(b.name || '')
      }
      const riskDiff =
        (RISK_ORDER[b.station_risk_tier] || 0) - (RISK_ORDER[a.station_risk_tier] || 0)
      return riskDiff || (a.name || '').localeCompare(b.name || '')
    })
    return rows
  }, [places, placesFilter])

  const filteredNews = useMemo(() => {
    let rows = [...newsArticles]
    const now = Date.now()
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    const todayMs = startOfToday.getTime()

    if (newsFilter.located === 'Located') {
      rows = rows.filter((a) => Number.isFinite(a.lat) && Number.isFinite(a.lon))
    } else if (newsFilter.located === 'Unlocated') {
      rows = rows.filter((a) => !(Number.isFinite(a.lat) && Number.isFinite(a.lon)))
    }

    if (newsFilter.date === 'Today') {
      rows = rows.filter((a) => toTime(a.published_at) >= todayMs)
    } else if (newsFilter.date === '24h') {
      rows = rows.filter((a) => toTime(a.published_at) >= now - 24 * 60 * 60 * 1000)
    } else if (newsFilter.date === '7d') {
      rows = rows.filter((a) => toTime(a.published_at) >= now - 7 * 24 * 60 * 60 * 1000)
    } else if (newsFilter.date === '30d') {
      rows = rows.filter((a) => toTime(a.published_at) >= now - 30 * 24 * 60 * 60 * 1000)
    }

    rows.sort((a, b) => {
      if (newsFilter.sort === 'oldest') return toTime(a.published_at) - toTime(b.published_at)
      if (newsFilter.sort === 'source') {
        const bySource = (a.source || '').localeCompare(b.source || '')
        return bySource || toTime(b.published_at) - toTime(a.published_at)
      }
      return toTime(b.published_at) - toTime(a.published_at)
    })
    return rows
  }, [newsArticles, newsFilter])

  const filteredCommunity = useMemo(() => {
    let rows = [...communityReports]
    if (communityFilter.severity !== 'All') {
      rows = rows.filter((r) => r.severity === communityFilter.severity)
    }
    if (communityFilter.status === 'Verified') {
      rows = rows.filter((r) => r.status === 'verified')
    } else if (communityFilter.status === 'Pending') {
      rows = rows.filter((r) => r.status !== 'verified')
    }
    rows.sort((a, b) => {
      if (communityFilter.sort === 'oldest') {
        return toTime(a.updated_at || a.created_at) - toTime(b.updated_at || b.created_at)
      }
      if (communityFilter.sort === 'severity') {
        const bySev =
          (SEVERITY_ORDER[b.severity] || 0) - (SEVERITY_ORDER[a.severity] || 0)
        return (
          bySev ||
          toTime(b.updated_at || b.created_at) - toTime(a.updated_at || a.created_at)
        )
      }
      return toTime(b.updated_at || b.created_at) - toTime(a.updated_at || a.created_at)
    })
    return rows
  }, [communityReports, communityFilter])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        className={clsx(
          'shrink-0 border-b px-4 py-4',
          dark ? 'border-gray-800' : 'border-slate-200',
        )}
      >
        <p
          className={clsx(
            'text-[10px] font-semibold uppercase tracking-[0.16em]',
            dark ? 'text-sky-400/80' : 'text-sky-700',
          )}
        >
          Early warning
        </p>
        <h2
          className={clsx(
            'mt-2 text-xl font-semibold tracking-tight leading-snug',
            dark ? 'text-gray-50' : 'text-slate-900',
          )}
        >
          Check flood risk for any place in Nigeria
        </h2>
        <p
          className={clsx(
            'mt-3 text-sm leading-relaxed',
            dark ? 'text-gray-400' : 'text-slate-600',
          )}
        >
          Tick a list below to browse nationwide places, news, or community reports.
          Search a city for a local outlook.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          {LIST_OPTIONS.map((opt) => (
            <label
              key={opt.id}
              className={clsx(
                'inline-flex cursor-pointer items-center gap-2 text-[12px] font-medium select-none',
                dark ? 'text-gray-200' : 'text-slate-700',
              )}
            >
              <input
                type="checkbox"
                checked={Boolean(active[opt.id])}
                onChange={() => toggle(opt.id)}
                className="h-3.5 w-3.5 rounded border-slate-400 accent-sky-600"
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>

      {openCount === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col justify-end overflow-y-auto p-4">
          <ul
            className={clsx(
              'space-y-2 text-xs',
              dark ? 'text-gray-400' : 'text-slate-500',
            )}
          >
            <li>Allow location, or search a city like Lokoja</li>
            <li>Check one or more lists to open them side by side</li>
            <li>Use each list’s filters to sort by risk, date, or severity</li>
          </ul>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto p-2">
          {active.places && (
            <PanelShell
              className={openCount === 1 ? 'min-w-0 flex-1' : 'min-w-[14rem] flex-1'}
              title="Nationwide places affected"
              subtitle="Warning+ · tap to open"
              count={placesLoading ? '…' : `${filteredPlaces.length}/${places.length}`}
              theme={theme}
              filters={(
                <FilterBar theme={theme}>
                  <select
                    aria-label="Filter places by risk"
                    value={placesFilter.risk}
                    onChange={(e) => setPlacesFilter((f) => ({ ...f, risk: e.target.value }))}
                    className={selectClass(dark)}
                  >
                    <option value="All">All risk</option>
                    <option value="Emergency">Emergency</option>
                    <option value="Warning">Warning</option>
                  </select>
                  <select
                    aria-label="Filter places by class"
                    value={placesFilter.placeClass}
                    onChange={(e) => setPlacesFilter((f) => ({ ...f, placeClass: e.target.value }))}
                    className={selectClass(dark)}
                  >
                    <option value="All">All classes</option>
                    <option value="City">City</option>
                    <option value="Town">Town</option>
                    <option value="Village">Village</option>
                  </select>
                  <select
                    aria-label="Sort places"
                    value={placesFilter.sort}
                    onChange={(e) => setPlacesFilter((f) => ({ ...f, sort: e.target.value }))}
                    className={selectClass(dark)}
                  >
                    <option value="risk">Sort: risk</option>
                    <option value="name">Sort: name</option>
                    <option value="state">Sort: state</option>
                  </select>
                </FilterBar>
              )}
            >
              {placesLoading && !places.length ? (
                <EmptyState theme={theme}>Loading places…</EmptyState>
              ) : places.length === 0 ? (
                <EmptyState theme={theme}>No places currently at elevated risk.</EmptyState>
              ) : filteredPlaces.length === 0 ? (
                <EmptyState theme={theme}>No places match these filters.</EmptyState>
              ) : (
                <ul className="space-y-1">
                  {filteredPlaces.map((place) => {
                    const tier = place.station_risk_tier || 'Warning'
                    return (
                      <li key={`${place.name}-${place.lat}-${place.lon}`}>
                        <button
                          type="button"
                          onClick={() =>
                            onSelectPlace?.({
                              name: place.name,
                              display_name: place.display_name || `${place.name}, Nigeria`,
                              lat: place.lat,
                              lon: place.lon,
                              bbox_lnglat: null,
                              class: place.class || null,
                              state: place.state || null,
                              station_risk_tier: place.station_risk_tier || null,
                              nearest_station: place.nearest_station || null,
                            })
                          }
                          className={clsx(
                            'flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition',
                            dark
                              ? 'border-gray-800 bg-gray-900/70 hover:border-gray-600'
                              : 'border-slate-200 bg-slate-50/80 hover:border-slate-300 hover:bg-white',
                          )}
                        >
                          <RiskPoint tier={tier} size={10} />
                          <span className="min-w-0 flex-1">
                            <span
                              className={clsx(
                                'block truncate text-[12px] font-medium',
                                dark ? 'text-gray-100' : 'text-slate-800',
                              )}
                            >
                              {place.name}
                            </span>
                            <span
                              className={clsx(
                                'block truncate text-[10px]',
                                dark ? 'text-gray-500' : 'text-slate-500',
                              )}
                            >
                              {place.class || 'Town'}
                              {place.state ? ` · ${place.state}` : ''}
                            </span>
                          </span>
                          <span
                            className="shrink-0 text-[10px] font-semibold"
                            style={{ color: RISK_COLOR[tier] || '#64748b' }}
                          >
                            {RISK_LABEL[tier] || tier}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </PanelShell>
          )}

          {active.news && (
            <PanelShell
              className={openCount === 1 ? 'min-w-0 flex-1' : 'min-w-[14rem] flex-1'}
              title="News report"
              subtitle="Media · tap to map"
              count={newsLoading ? '…' : `${filteredNews.length}/${newsArticles.length}`}
              theme={theme}
              filters={(
                <FilterBar theme={theme}>
                  <select
                    aria-label="Filter news by location"
                    value={newsFilter.located}
                    onChange={(e) => setNewsFilter((f) => ({ ...f, located: e.target.value }))}
                    className={selectClass(dark)}
                  >
                    <option value="All">All reports</option>
                    <option value="Located">Located only</option>
                    <option value="Unlocated">Unlocated</option>
                  </select>
                  <select
                    aria-label="Filter news by date"
                    value={newsFilter.date}
                    onChange={(e) => setNewsFilter((f) => ({ ...f, date: e.target.value }))}
                    className={selectClass(dark)}
                  >
                    <option value="All">All dates</option>
                    <option value="Today">Today</option>
                    <option value="24h">Last 24 hours</option>
                    <option value="7d">Last 7 days</option>
                    <option value="30d">Last 30 days</option>
                  </select>
                  <select
                    aria-label="Sort news"
                    value={newsFilter.sort}
                    onChange={(e) => setNewsFilter((f) => ({ ...f, sort: e.target.value }))}
                    className={selectClass(dark)}
                  >
                    <option value="newest">Sort: newest</option>
                    <option value="oldest">Sort: oldest</option>
                    <option value="source">Sort: source</option>
                  </select>
                </FilterBar>
              )}
            >
              {newsLoading && !newsArticles.length ? (
                <EmptyState theme={theme}>Loading news…</EmptyState>
              ) : newsArticles.length === 0 ? (
                <EmptyState theme={theme}>
                  {newsUnavailable
                    ? 'News sources are temporarily unavailable.'
                    : 'No recent flood reports found.'}
                </EmptyState>
              ) : filteredNews.length === 0 ? (
                <EmptyState theme={theme}>No reports match these filters.</EmptyState>
              ) : (
                <ul className="space-y-1">
                  {filteredNews.map((article) => {
                    const located = Number.isFinite(article.lat) && Number.isFinite(article.lon)
                    return (
                      <li key={article.url}>
                        <button
                          type="button"
                          onClick={() => onFocusNews?.(article)}
                          className={clsx(
                            'flex w-full items-start gap-2.5 rounded-lg border p-2 text-left transition',
                            dark
                              ? 'border-gray-800 bg-gray-900/70 hover:border-sky-700'
                              : 'border-slate-200 bg-slate-50/80 hover:border-sky-300 hover:bg-white',
                          )}
                        >
                          <span
                            className={clsx(
                              'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border',
                              dark
                                ? 'border-sky-800/60 bg-sky-950/50 text-sky-400'
                                : 'border-sky-200 bg-sky-50 text-sky-700',
                            )}
                            aria-hidden
                          >
                            <IconNewspaper size={13} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <p
                              className={clsx(
                                'line-clamp-2 text-[11px] font-semibold leading-snug',
                                dark ? 'text-gray-100' : 'text-slate-800',
                              )}
                            >
                              {article.title}
                            </p>
                            <div className="mt-1 flex items-center justify-between gap-2 text-[9px]">
                              <span className="truncate font-semibold text-sky-500">{article.source}</span>
                              <span className={dark ? 'text-gray-500' : 'text-slate-400'}>
                                {relativeTime(article.published_at)}
                              </span>
                            </div>
                            <p
                              className={clsx(
                                'mt-0.5 text-[9px]',
                                located ? 'text-emerald-500' : dark ? 'text-gray-500' : 'text-slate-400',
                              )}
                            >
                              {located
                                ? `${article.location || 'Located'} · tap to map`
                                : 'Location not identified · open report'}
                            </p>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </PanelShell>
          )}

          {active.community && (
            <PanelShell
              className={openCount === 1 ? 'min-w-0 flex-1' : 'min-w-[14rem] flex-1'}
              title="Community report"
              subtitle="Crowdsourced · tap to locate"
              count={
                communityLoading
                  ? '…'
                  : `${filteredCommunity.length}/${communityReports.length}`
              }
              theme={theme}
              filters={(
                <FilterBar theme={theme}>
                  <select
                    aria-label="Filter community reports by severity"
                    value={communityFilter.severity}
                    onChange={(e) =>
                      setCommunityFilter((f) => ({ ...f, severity: e.target.value }))
                    }
                    className={selectClass(dark)}
                  >
                    <option value="All">All severity</option>
                    <option value="Critical">Critical</option>
                    <option value="High">High</option>
                    <option value="Moderate">Moderate</option>
                    <option value="Low">Low</option>
                  </select>
                  <select
                    aria-label="Filter community reports by status"
                    value={communityFilter.status}
                    onChange={(e) =>
                      setCommunityFilter((f) => ({ ...f, status: e.target.value }))
                    }
                    className={selectClass(dark)}
                  >
                    <option value="All">All status</option>
                    <option value="Verified">Verified</option>
                    <option value="Pending">Pending</option>
                  </select>
                  <select
                    aria-label="Sort community reports"
                    value={communityFilter.sort}
                    onChange={(e) =>
                      setCommunityFilter((f) => ({ ...f, sort: e.target.value }))
                    }
                    className={selectClass(dark)}
                  >
                    <option value="newest">Sort: newest</option>
                    <option value="oldest">Sort: oldest</option>
                    <option value="severity">Sort: severity</option>
                  </select>
                </FilterBar>
              )}
            >
              {communityLoading && !communityReports.length ? (
                <EmptyState theme={theme}>Loading reports…</EmptyState>
              ) : communityReports.length === 0 ? (
                <EmptyState theme={theme}>No community reports yet.</EmptyState>
              ) : filteredCommunity.length === 0 ? (
                <EmptyState theme={theme}>No reports match these filters.</EmptyState>
              ) : (
                <ul className="space-y-1">
                  {filteredCommunity.map((report) => (
                    <li key={report.id}>
                      <button
                        type="button"
                        onClick={() => onFocusCommunityReport?.(report)}
                        className={clsx(
                          'flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition',
                          dark
                            ? 'border-gray-800 bg-gray-900/70 hover:border-gray-600'
                            : 'border-slate-200 bg-slate-50/80 hover:border-slate-300 hover:bg-white',
                        )}
                      >
                        <span
                          className={clsx(
                            'mt-1 h-2 w-2 shrink-0 rounded-full',
                            SEVERITY_DOT[report.severity] || 'bg-slate-400',
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span
                            className={clsx(
                              'block truncate text-[12px] font-medium',
                              dark ? 'text-gray-100' : 'text-slate-800',
                            )}
                          >
                            {report.location_name}
                          </span>
                          <span
                            className={clsx(
                              'mt-0.5 block truncate text-[10px]',
                              dark ? 'text-gray-500' : 'text-slate-500',
                            )}
                          >
                            {report.incident_type} · {report.severity}
                          </span>
                          <span
                            className={clsx(
                              'mt-1 line-clamp-2 text-[10px] leading-snug',
                              dark ? 'text-gray-400' : 'text-slate-600',
                            )}
                          >
                            {report.description}
                          </span>
                        </span>
                        <span
                          className={clsx(
                            'shrink-0 text-[9px]',
                            dark ? 'text-gray-500' : 'text-slate-400',
                          )}
                        >
                          {relativeTime(report.updated_at || report.created_at)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </PanelShell>
          )}
        </div>
      )}
    </div>
  )
}
