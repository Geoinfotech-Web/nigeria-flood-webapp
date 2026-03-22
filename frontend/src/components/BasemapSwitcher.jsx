import React, { useState } from 'react'
import { BASEMAPS } from './MapPanel'
import { IconLayers, IconMoon, IconSun, IconMap, IconSatellite, IconMountain,
         IconChevronUp, IconChevronDown, IconCheck } from './Icons'
import clsx from 'clsx'

const BASEMAP_ICON = {
  dark:      IconMoon,
  light:     IconSun,
  streets:   IconMap,
  satellite: IconSatellite,
  topo:      IconMountain,
}

export default function BasemapSwitcher({ current, onChange }) {
  const [expanded, setExpanded] = useState(false)
  const CurrentIcon = BASEMAP_ICON[current] ?? IconLayers
  const currentLabel = BASEMAPS.find(b => b.id === current)?.label ?? 'Map'

  return (
    <div className="relative">
      <button
        onClick={() => setExpanded(v => !v)}
        title="Change basemap"
        className="flex items-center gap-2 px-3 py-2 bg-gray-900/90 backdrop-blur
                   border border-gray-700 rounded-lg shadow-lg text-xs font-medium
                   text-gray-200 hover:bg-gray-800 hover:border-gray-600 transition-colors"
      >
        <IconLayers size={14} className="text-gray-400" />
        <CurrentIcon size={14} className="text-blue-400" />
        <span>{currentLabel}</span>
        {expanded
          ? <IconChevronUp size={11} className="text-gray-500 ml-0.5" />
          : <IconChevronDown size={11} className="text-gray-500 ml-0.5" />
        }
      </button>

      {expanded && (
        <div className="absolute bottom-full mb-2 right-0 bg-gray-900/98 backdrop-blur
                        border border-gray-700 rounded-lg shadow-2xl overflow-hidden w-40
                        divide-y divide-gray-800">
          {BASEMAPS.map(b => {
            const Icon = BASEMAP_ICON[b.id] ?? IconLayers
            const active = current === b.id
            return (
              <button
                key={b.id}
                onClick={() => { onChange(b.id); setExpanded(false) }}
                className={clsx(
                  'w-full flex items-center gap-2.5 px-3 py-2.5 text-xs transition-colors',
                  active
                    ? 'bg-blue-950/60 text-blue-300'
                    : 'text-gray-300 hover:bg-gray-800/80 hover:text-white'
                )}
              >
                <Icon size={14} className={active ? 'text-blue-400' : 'text-gray-400'} />
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
