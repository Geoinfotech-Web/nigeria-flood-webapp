import React, { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import { IconAlertTriangle, IconX } from './Icons'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

function relativeTime(value) {
  if (!value) return 'recent'
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000))
  if (minutes < 60) return `${Math.max(1, minutes)}m ago`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`
  return `${Math.floor(minutes / 1440)}d ago`
}

export default function FloodNewsLayer({ theme, onClose, onArticles, onFocus }) {
  const dark = theme === 'dark'
  const [articles, setArticles] = useState([])
  const [loading, setLoading] = useState(true)
  const [unavailable, setUnavailable] = useState(false)

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${API}/news?limit=20`, { cache: 'no-store' })
      if (!response.ok) throw new Error('News request failed')
      const data = await response.json()
      const next = data.articles || []
      setArticles(next)
      setUnavailable(Boolean(data.unavailable))
      onArticles(next)
    } catch (_) {
      setUnavailable(true)
    } finally {
      setLoading(false)
    }
  }, [onArticles])

  useEffect(() => {
    load()
    const timer = setInterval(load, 60000)
    return () => clearInterval(timer)
  }, [load])

  return (
    <aside className={clsx('absolute left-3 right-3 top-16 z-10 flex max-h-[min(72vh,38rem)] w-auto flex-col overflow-hidden rounded-xl border shadow-2xl sm:left-[17rem] sm:right-auto sm:top-3 sm:w-[23rem]', dark ? 'border-gray-700 bg-gray-900' : 'border-slate-200 bg-white')}>
      <header className={clsx('flex items-start justify-between border-b px-3.5 py-3', dark ? 'border-gray-800' : 'border-slate-100')}>
        <div>
          <div className="flex items-center gap-2"><span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /><h3 className={clsx('text-xs font-bold', dark ? 'text-white' : 'text-slate-900')}>Flood news reports</h3></div>
          <p className={clsx('mt-1 text-[9px]', dark ? 'text-gray-500' : 'text-slate-500')}>Nigeria · refreshed every minute · click a report to locate it</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close flood news" className={clsx('rounded-md p-1', dark ? 'text-gray-400 hover:bg-gray-800' : 'text-slate-500 hover:bg-slate-100')}><IconX size={14} /></button>
      </header>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2.5">
        {loading && <p className={clsx('px-2 py-8 text-center text-[10px]', dark ? 'text-gray-500' : 'text-slate-400')}>Loading recent flood reports…</p>}
        {!loading && articles.length === 0 && <p className={clsx('px-2 py-8 text-center text-[10px]', dark ? 'text-gray-500' : 'text-slate-400')}>{unavailable ? 'News sources are temporarily unavailable.' : 'No recent flood reports found.'}</p>}
        {articles.map((article) => {
          const located = Number.isFinite(article.lat) && Number.isFinite(article.lon)
          return <button key={article.url} type="button" onClick={() => onFocus(article)} className={clsx('block w-full rounded-lg border p-2 text-left transition', dark ? 'border-gray-700 bg-gray-800/80 hover:border-sky-600 hover:bg-gray-800' : 'border-slate-200 bg-sky-50/60 hover:border-sky-400 hover:bg-sky-50')}>
            <div className="flex items-stretch gap-2.5">
              {article.image_url && article.image_kind === 'report' && <div className={clsx('flex h-[4.75rem] w-20 shrink-0 items-center justify-center overflow-hidden rounded-md', dark ? 'bg-gray-700' : 'bg-slate-200')}><img src={article.image_url} alt="Flood report" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-cover" onError={(event) => { event.currentTarget.parentElement.style.display = 'none' }} /></div>}
              <div className="min-w-0 flex-1">
                <p className={clsx('line-clamp-3 text-[10px] font-semibold leading-relaxed', dark ? 'text-gray-100' : 'text-slate-800')}>{article.title}</p>
                <div className="mt-1.5 flex items-center justify-between gap-2 text-[8px]"><span className="truncate font-semibold text-sky-500">{article.source}</span><span className={dark ? 'text-gray-400' : 'text-slate-400'}>{relativeTime(article.published_at)}</span></div>
                <div className={clsx('mt-1 text-[8px] font-medium', located ? 'text-emerald-500' : dark ? 'text-gray-500' : 'text-slate-400')}>{located ? `📍 ${article.location} · inferred from headline` : 'Location not identified · open report'}</div>
              </div>
            </div>
          </button>
        })}
      </div>
      <footer className={clsx('flex gap-1.5 border-t px-3 py-2 text-[8px]', dark ? 'border-gray-800 text-gray-500' : 'border-slate-100 text-slate-400')}><IconAlertTriangle size={10} className="shrink-0" />Media reports are unverified and may describe the same event.</footer>
    </aside>
  )
}
