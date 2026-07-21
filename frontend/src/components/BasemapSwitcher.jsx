import React, { useState } from 'react'
import clsx from 'clsx'
import {
  IconLayers, IconMoon, IconSun, IconMap, IconSatellite, IconMountain,
  IconChevronUp, IconChevronDown, IconCheck,
} from './Icons'

const BASEMAP_ICON = {
  dark: IconMoon,
  light: IconSun,
  streets: IconMap,
  satellite: IconSatellite,
  topo: IconMountain,
  google: IconMap,
  'google-sat': IconSatellite,
}

export default function BasemapSwitcher({ current, onChange, options, theme = 'dark' }) {
  const [expanded, setExpanded] = useState(false)
  const currentOption = options.find(option => option.id === current) ?? null
  const CurrentIcon = BASEMAP_ICON[currentOption?.id] ?? IconLayers

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        title="Change basemap"
        className={clsx(
          'inline-flex h-10 w-10 items-center justify-center rounded-xl border shadow-lg transition',
          theme === 'dark'
            ? 'border-gray-700 bg-gray-900 text-gray-200 hover:border-gray-500 hover:bg-gray-800 hover:text-white'
            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
        )}
        style={
          theme === 'dark'
            ? { backgroundColor: '#111827', borderColor: '#374151' }
            : { backgroundColor: '#ffffff', borderColor: '#cbd5e1' }
        }
        aria-label="Change basemap"
        aria-expanded={expanded}
      >
        <span className="relative inline-flex">
          <IconLayers size={16} className={theme === 'dark' ? 'text-gray-300' : 'text-slate-600'} />
          <span
            className="absolute -right-1.5 -bottom-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm"
            style={{ border: `1px solid ${theme === 'dark' ? '#111827' : '#e2e8f0'}` }}
          >
            <CurrentIcon size={9} />
          </span>
        </span>
      </button>

      {expanded && (
        <div
          className={clsx(
            'absolute top-full right-0 mt-2 w-40 overflow-hidden rounded-lg border shadow-2xl divide-y',
            theme === 'dark'
              ? 'bg-gray-900 border-gray-700 divide-gray-800'
              : 'bg-white border-slate-200 divide-slate-200'
          )}
          style={
            theme === 'dark'
              ? { backgroundColor: '#111827', borderColor: '#374151' }
              : { backgroundColor: '#ffffff', borderColor: '#cbd5e1' }
          }
        >
          <div className={clsx('flex items-center justify-between px-3 py-2 text-[11px] uppercase tracking-[0.18em]', theme === 'dark' ? 'text-gray-500' : 'text-slate-500')}>
            <span>Basemap</span>
            {expanded
              ? <IconChevronUp size={11} className={theme === 'dark' ? 'text-gray-500' : 'text-slate-500'} />
              : <IconChevronDown size={11} className={theme === 'dark' ? 'text-gray-500' : 'text-slate-500'} />
            }
          </div>

          {options.map(b => {
            const Icon = BASEMAP_ICON[b.id] ?? IconLayers
            const active = current === b.id
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => { onChange(b.id); setExpanded(false) }}
                className={clsx(
                  'flex w-full items-center gap-2.5 px-3 py-2.5 text-xs transition-colors',
                  active
                    ? 'bg-blue-950/60 text-blue-300'
                    : theme === 'dark'
                      ? 'text-gray-300 hover:bg-gray-800/80 hover:text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                )}
              >
                <Icon size={14} className={active ? 'text-blue-400' : theme === 'dark' ? 'text-gray-400' : 'text-slate-400'} />
                <span className="flex-1 text-left">{b.label}</span>
                {active && <IconCheck size={11} className="text-blue-400" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
