import React, { useState, useRef, useEffect } from 'react'
import axios from 'axios'
import clsx from 'clsx'
import { IconSearch, IconX } from './Icons'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export default function SearchBar({
  onResult,
  theme = 'dark',
  size = 'md',
  placeholder = 'Search cities, states, rivers...',
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const debounce = useRef(null)
  const wrapRef = useRef(null)
  const large = size === 'lg'

  useEffect(() => {
    if (query.length < 2) {
      setResults([])
      setOpen(false)
      return
    }
    clearTimeout(debounce.current)
    debounce.current = setTimeout(async () => {
      setLoading(true)
      try {
        const { data } = await axios.get(`${API}/geocode/search`, { params: { q: query, limit: 6 } })
        setResults(data)
        setOpen(data.length > 0)
      } catch {
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 400)
  }, [query])

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const select = (r) => {
    setQuery(r.name)
    setOpen(false)
    onResult(r)
  }

  return (
    <div ref={wrapRef} className="relative w-full">
      <div
        className={clsx(
          'flex items-center gap-2 border shadow-lg backdrop-blur transition-colors focus-within:border-sky-500/70',
          large ? 'rounded-2xl px-4' : 'rounded-lg px-3',
          theme === 'dark' ? 'bg-gray-900/95 border-gray-700' : 'bg-white/96 border-slate-200',
        )}
      >
        {loading ? (
          <span
            className={clsx(
              'h-4 w-4 shrink-0 rounded-full border-2 animate-spin',
              theme === 'dark' ? 'border-gray-600 border-t-sky-400' : 'border-slate-300 border-t-sky-600',
            )}
          />
        ) : (
          <IconSearch
            size={large ? 17 : 15}
            className={clsx('shrink-0', theme === 'dark' ? 'text-gray-500' : 'text-slate-500')}
          />
        )}
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder={placeholder}
          className={clsx(
            'flex-1 bg-transparent outline-none',
            large ? 'py-3.5 text-[15px]' : 'py-2.5 text-sm',
            theme === 'dark' ? 'text-white placeholder-gray-500' : 'text-slate-900 placeholder-slate-400',
          )}
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('')
              setResults([])
              setOpen(false)
            }}
            className={clsx(
              'shrink-0 transition-colors',
              theme === 'dark' ? 'text-gray-500 hover:text-gray-300' : 'text-slate-500 hover:text-slate-700',
            )}
          >
            <IconX size={13} />
          </button>
        )}
      </div>

      {open && (
        <div
          className={clsx(
            'absolute top-full z-50 mt-1.5 w-full overflow-hidden border shadow-2xl backdrop-blur divide-y',
            large ? 'rounded-2xl' : 'rounded-lg',
            theme === 'dark'
              ? 'bg-gray-900/98 border-gray-700 divide-gray-800'
              : 'bg-white/98 border-slate-200 divide-slate-200',
          )}
        >
          {results.map((r, i) => (
            <button
              key={`${r.name}-${i}`}
              type="button"
              onClick={() => select(r)}
              className={clsx(
                'w-full px-4 py-2.5 text-left transition-colors',
                theme === 'dark' ? 'hover:bg-gray-800' : 'hover:bg-slate-100',
              )}
            >
              <div
                className={clsx(
                  'truncate text-sm font-medium',
                  theme === 'dark' ? 'text-white' : 'text-slate-900',
                )}
              >
                {r.name}
              </div>
              <div
                className={clsx(
                  'mt-0.5 truncate text-xs',
                  theme === 'dark' ? 'text-gray-400' : 'text-slate-500',
                )}
              >
                {r.display_name}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
