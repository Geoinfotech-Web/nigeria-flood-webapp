import React, { useState } from 'react'
import clsx from 'clsx'
import { IconChevronDown, IconChevronUp } from './Icons'

const TIERS = [
  { tier: 'Emergency', color: '#ef4444', range: '> 75%' },
  { tier: 'Warning', color: '#f97316', range: '50-75%' },
  { tier: 'Watch', color: '#eab308', range: '25-50%' },
  { tier: 'Normal', color: '#22c55e', range: '< 25%' },
]

const EXPOSURE_SYMBOLS = {
  roads: [
    { label: 'Highway', color: '#f59e0b', type: 'line', dash: false },
    { label: 'Major Road', color: '#fb923c', type: 'line', dash: false },
    { label: 'Secondary Road', color: '#38bdf8', type: 'line', dash: false },
    { label: 'Tertiary Road', color: '#cbd5e1', type: 'line', dash: true },
  ],
  bridges: [
    { label: 'Bridge', color: '#fde68a', stroke: '#7c2d12', type: 'circle' },
  ],
  places: [
    { label: 'City', color: '#f8fafc', stroke: '#0f172a', type: 'circle' },
    { label: 'Town', color: '#cbd5e1', stroke: '#0f172a', type: 'circle' },
    { label: 'Village', color: '#94a3b8', stroke: '#0f172a', type: 'circle' },
  ],
}

export default function FloodRiskLegend({
  overlayLegend = null,
  exposureLayers = [],
  exposureVisibility = {},
  onToggleExposure,
  theme = 'dark',
}) {
  const isOverlayLegend = Boolean(overlayLegend)
  const [collapsed, setCollapsed] = useState(false)
  const visibleExposureLayers = exposureLayers.filter(layer => exposureVisibility[layer.id])

  return (
    <div
      className={clsx(
        'w-56 overflow-hidden rounded-lg border shadow-xl',
        theme === 'dark' ? 'bg-gray-900/90 border-gray-700/80 backdrop-blur' : 'bg-white border-slate-200'
      )}
    >
      <button
        type="button"
        onClick={() => setCollapsed(current => !current)}
        className={clsx(
          'flex w-full items-center justify-between gap-3 border-b px-3 py-2.5 text-left transition',
          theme === 'dark' ? 'border-gray-800/90 hover:bg-gray-800/40' : 'border-slate-200 hover:bg-slate-50'
        )}
        aria-label={collapsed ? 'Expand legend panel' : 'Collapse legend panel'}
        title={collapsed ? 'Expand' : 'Collapse'}
      >
        <div>
          <p className={clsx('text-[10px] font-semibold uppercase tracking-widest', theme === 'dark' ? 'text-gray-500' : 'text-slate-500')}>
            Map Context
          </p>
          <p className={clsx('mt-0.5 text-[10px]', theme === 'dark' ? 'text-gray-600' : 'text-slate-500')}>
            Flood legend and exposure layers
          </p>
        </div>
        <span className={theme === 'dark' ? 'text-gray-500' : 'text-slate-500'}>
          {collapsed ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />}
        </span>
      </button>

      {!collapsed && (
        <div className="p-3">
          <p className={clsx('mb-2.5 text-[10px] font-semibold uppercase tracking-widest', theme === 'dark' ? 'text-gray-500' : 'text-slate-500')}>
            {overlayLegend?.title || 'Flood Risk'}
          </p>

          {overlayLegend?.subtitle && (
            <p className={clsx('mb-2.5 text-[10px] leading-tight', theme === 'dark' ? 'text-gray-500' : 'text-slate-500')}>
              {overlayLegend.subtitle}
            </p>
          )}

          {overlayLegend?.type === 'gradient' ? (
            <div className="space-y-2">
              <div
                className={clsx('h-3 rounded-md border', theme === 'dark' ? 'border-gray-700' : 'border-slate-200')}
                style={{ background: overlayLegend.gradient }}
              />
              <div className={clsx('flex justify-between text-[10px] tabular-nums', theme === 'dark' ? 'text-gray-500' : 'text-slate-500')}>
                <span>{overlayLegend.min_label}</span>
                <span>{overlayLegend.max_label}</span>
              </div>
            </div>
          ) : overlayLegend?.type === 'categories' ? (
            <div className="space-y-1.5">
              {overlayLegend.items.map(item => (
                <div key={item.label} className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ background: item.color, boxShadow: `0 0 5px ${item.color}70` }}
                  />
                  <span className={clsx('text-[11px] font-medium', theme === 'dark' ? 'text-gray-200' : 'text-slate-800')}>{item.label}</span>
                  <span className={clsx('ml-auto text-[10px] tabular-nums', theme === 'dark' ? 'text-gray-500' : 'text-slate-500')}>{item.range}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-1.5">
              {TIERS.map(t => (
                <div key={t.tier} className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ background: t.color, boxShadow: `0 0 5px ${t.color}70` }}
                  />
                  <span className={clsx('text-[11px] font-medium', theme === 'dark' ? 'text-gray-200' : 'text-slate-800')}>{t.tier}</span>
                  <span className={clsx('ml-auto text-[10px] tabular-nums', theme === 'dark' ? 'text-gray-500' : 'text-slate-500')}>{t.range}</span>
                </div>
              ))}
            </div>
          )}

          <div className={clsx('mt-2.5 border-t pt-2', theme === 'dark' ? 'border-gray-800' : 'border-slate-200')}>
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-blue-400 shadow-[0_0_5px_#60a5fa70]" />
              <span className={clsx('text-[10px]', theme === 'dark' ? 'text-gray-500' : 'text-slate-500')}>Gauge station</span>
            </div>
            {isOverlayLegend && (
              <p className={clsx('mt-2 text-[10px] leading-tight', theme === 'dark' ? 'text-gray-500' : 'text-slate-500')}>
                Overlay legend follows the selected satellite layer.
              </p>
            )}
          </div>

          {exposureLayers.length > 0 && (
            <div className={clsx('mt-3 space-y-2 border-t pt-3', theme === 'dark' ? 'border-gray-800' : 'border-slate-200')}>
              <div className="flex items-center justify-between">
                <p className={clsx('text-[10px] font-semibold uppercase tracking-widest', theme === 'dark' ? 'text-gray-500' : 'text-slate-500')}>
                  Exposure Layers
                </p>
                <span className={clsx('text-[10px]', theme === 'dark' ? 'text-gray-600' : 'text-slate-500')}>OSM</span>
              </div>

              <div className="space-y-1">
                {exposureLayers.map(layer => (
                  <button
                    key={layer.id}
                    type="button"
                    onClick={() => onToggleExposure?.(layer.id)}
                    className={clsx(
                      'w-full rounded-lg border px-2.5 py-2 text-left transition',
                      exposureVisibility[layer.id]
                        ? 'border-blue-600/70 bg-blue-950/50'
                        : theme === 'dark'
                          ? 'border-gray-800 bg-gray-800/40 hover:border-gray-700 hover:bg-gray-800/70'
                          : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white'
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span
                        className={clsx(
                          'text-[11px] font-medium',
                          exposureVisibility[layer.id]
                            ? 'text-white'
                            : theme === 'dark'
                              ? 'text-gray-300'
                              : 'text-slate-800'
                        )}
                      >
                        {layer.label}
                      </span>
                      <span className={clsx('text-[10px]', exposureVisibility[layer.id] ? 'text-blue-200' : theme === 'dark' ? 'text-gray-500' : 'text-slate-500')}>
                        {layer.feature_count?.toLocaleString?.() ?? layer.feature_count}
                      </span>
                    </div>

                    <p className={clsx('mt-1 text-[10px] leading-tight', theme === 'dark' ? 'text-gray-500' : 'text-slate-500')}>
                      {layer.description}
                    </p>
                  </button>
                ))}
              </div>

              <p className={clsx('text-[10px] leading-tight', theme === 'dark' ? 'text-gray-500' : 'text-slate-500')}>
                Adds roads, bridges, and settlements for impact context.
              </p>

              {visibleExposureLayers.length > 0 && (
                <div className={clsx('space-y-2 border-t pt-2', theme === 'dark' ? 'border-gray-800' : 'border-slate-200')}>
                  <p className={clsx('text-[10px] font-semibold uppercase tracking-widest', theme === 'dark' ? 'text-gray-500' : 'text-slate-500')}>
                    Exposure Symbology
                  </p>

                  {visibleExposureLayers.map(layer => (
                    <div key={`${layer.id}-symbols`} className="space-y-1">
                      <p className={clsx('text-[10px] font-medium', theme === 'dark' ? 'text-gray-400' : 'text-slate-500')}>
                        {layer.label}
                      </p>

                      <div className="space-y-1">
                        {(EXPOSURE_SYMBOLS[layer.id] || []).map(symbol => (
                          <div key={`${layer.id}-${symbol.label}`} className="flex items-center gap-2">
                            {symbol.type === 'line' ? (
                              <span
                                className="block w-5 shrink-0"
                                style={{
                                  background: symbol.dash ? 'transparent' : symbol.color,
                                  borderTop: symbol.dash ? `2px dashed ${symbol.color}` : 'none',
                                  borderRadius: symbol.dash ? 0 : 999,
                                  height: 2,
                                }}
                              />
                            ) : (
                              <span
                                className="h-2.5 w-2.5 shrink-0 rounded-full"
                                style={{
                                  background: symbol.color,
                                  border: `1.2px solid ${symbol.stroke || symbol.color}`,
                                  boxShadow: `0 0 5px ${symbol.color}55`,
                                }}
                              />
                            )}
                            <span className={clsx('text-[10px]', theme === 'dark' ? 'text-gray-400' : 'text-slate-500')}>{symbol.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
