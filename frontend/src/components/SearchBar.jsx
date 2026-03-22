import React, { useState, useRef, useEffect } from 'react'
import axios from 'axios'
import { IconSearch, IconX } from './Icons'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export default function SearchBar({ onResult }) {
  const [query,   setQuery]   = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [open,    setOpen]    = useState(false)
  const debounce  = useRef(null)
  const wrapRef   = useRef(null)

  useEffect(() => {
    if (query.length < 2) { setResults([]); setOpen(false); return }
    clearTimeout(debounce.current)
    debounce.current = setTimeout(async () => {
      setLoading(true)
      try {
        const { data } = await axios.get(`${API}/geocode/search`, { params: { q: query, limit: 6 } })
        setResults(data)
        setOpen(data.length > 0)
      } catch { setResults([]) }
      finally { setLoading(false) }
    }, 400)
  }, [query])

  useEffect(() => {
    const handler = e => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const select = r => {
    setQuery(r.name)
    setOpen(false)
    onResult(r)
  }

  return (
    <div ref={wrapRef} className="relative">
      <div className="flex items-center gap-2 bg-gray-900/95 backdrop-blur
                      border border-gray-700 rounded-lg shadow-lg px-3
                      focus-within:border-blue-500/60 transition-colors">
        {loading
          ? <span className="w-4 h-4 rounded-full border-2 border-gray-600 border-t-blue-400
                             animate-spin shrink-0" />
          : <IconSearch size={15} className="text-gray-500 shrink-0" />
        }
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder="Search cities, states, rivers..."
          className="flex-1 bg-transparent py-2.5 text-sm text-white
                     placeholder-gray-500 outline-none"
        />
        {query && (
          <button
            onClick={() => { setQuery(''); setResults([]); setOpen(false) }}
            className="text-gray-500 hover:text-gray-300 transition-colors shrink-0"
          >
            <IconX size={13} />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute top-full mt-1.5 w-full bg-gray-900/98 backdrop-blur
                        border border-gray-700 rounded-lg shadow-2xl overflow-hidden z-50
                        divide-y divide-gray-800">
          {results.map((r, i) => (
            <button
              key={i}
              onClick={() => select(r)}
              className="w-full text-left px-4 py-2.5 hover:bg-gray-800 transition-colors"
            >
              <div className="text-sm text-white font-medium truncate">{r.name}</div>
              <div className="text-xs text-gray-400 truncate mt-0.5">{r.display_name}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
