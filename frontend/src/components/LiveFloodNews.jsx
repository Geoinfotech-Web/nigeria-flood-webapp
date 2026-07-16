import React, { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import { IconAlertTriangle } from './Icons'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

function relativeTime(value) {
  if (!value) return 'recent'
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`
  return `${Math.floor(minutes / 1440)}d ago`
}

export default function LiveFloodNews({ station, theme }) {
  const dark = theme === 'dark'
  const [articles, setArticles] = useState([])
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  const loadNews = useCallback(async () => {
    try {
      const params = new URLSearchParams({ location: station.state, limit: '6' })
      const response = await fetch(`${API}/news?${params}`, { cache: 'no-store' })
      if (!response.ok) throw new Error('News request failed')
      const data = await response.json()
      setArticles(data.articles || [])
      setUnavailable(Boolean(data.unavailable))
      setUpdatedAt(data.refreshed_at)
    } catch (_) {
      setUnavailable(true)
    } finally {
      setLoading(false)
    }
  }, [station.state])

  useEffect(() => {
    setLoading(true)
    loadNews()
    const timer = setInterval(loadNews, 60000)
    return () => clearInterval(timer)
  }, [loadNews])

  return (
    <section className={clsx('border-b px-4 py-3', dark ? 'border-gray-800 bg-gray-950/35' : 'border-slate-200 bg-slate-50/80')}>
      <div className="mb-2.5 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-70" /><span className="relative h-2 w-2 rounded-full bg-red-500" /></span>
            <h3 className={clsx('text-[11px] font-semibold uppercase tracking-wider', dark ? 'text-gray-200' : 'text-slate-700')}>Live flood news</h3>
          </div>
          <p className={clsx('mt-1 text-[9px]', dark ? 'text-gray-500' : 'text-slate-400')}>{station.state} · refreshes every minute</p>
        </div>
        <span className={clsx('rounded-full border px-2 py-0.5 text-[8px] font-semibold', unavailable ? 'border-amber-500/30 bg-amber-500/10 text-amber-500' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500')}>{unavailable ? 'RECONNECTING' : 'RSS LIVE'}</span>
      </div>

      <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
        {loading && <div className={clsx('rounded-lg border px-3 py-5 text-center text-[10px]', dark ? 'border-gray-800 text-gray-500' : 'border-slate-200 text-slate-400')}>Checking live flood sources…</div>}
        {!loading && articles.length === 0 && <div className={clsx('rounded-lg border px-3 py-5 text-center text-[10px]', dark ? 'border-gray-800 text-gray-500' : 'border-slate-200 text-slate-400')}>No recent flood stories found for {station.state}.</div>}
        {articles.map(article => (
          <a key={article.url} href={article.url} target="_blank" rel="noopener noreferrer" className={clsx('group block rounded-lg border px-3 py-2 transition', dark ? 'border-gray-800 bg-gray-900/70 hover:border-gray-700 hover:bg-gray-900' : 'border-slate-200 bg-white hover:border-slate-300')}>
            <div className="flex items-start gap-2">
              <p className={clsx('line-clamp-2 flex-1 text-[10px] font-medium leading-relaxed', dark ? 'text-gray-200 group-hover:text-white' : 'text-slate-700 group-hover:text-slate-950')}>{article.title}</p>
              <svg className={clsx('mt-0.5 shrink-0', dark ? 'text-gray-600' : 'text-slate-400')} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>
            </div>
            <div className={clsx('mt-1.5 flex items-center justify-between text-[8px]', dark ? 'text-gray-500' : 'text-slate-400')}><span className="max-w-[70%] truncate font-semibold text-blue-500">{article.source}</span><span>{relativeTime(article.published_at)}</span></div>
          </a>
        ))}
      </div>

      <div className={clsx('mt-2 flex items-start gap-1.5 text-[8px] leading-relaxed', dark ? 'text-gray-600' : 'text-slate-400')}><IconAlertTriangle size={10} className="mt-0.5 shrink-0" /><span>Media leads are live but not verified flood incident totals.{updatedAt ? ` Checked ${relativeTime(updatedAt)}.` : ''}</span></div>
    </section>
  )
}
