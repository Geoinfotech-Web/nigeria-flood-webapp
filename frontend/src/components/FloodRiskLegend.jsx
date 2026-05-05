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
}) {
  const isOverlayLegend = Boolean(overlayLegend)
  const [collapsed, setCollapsed] = useState(false)
  const visibleExposureLayers = exposureLayers.filter(layer => exposureVisibility[layer.id])

  return (
    <div className="bg-gray-900/90 backdrop-blur border border-gray-700/80 rounded-lg shadow-xl w-56 overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed(current => !current)}
        className="w-full flex items-center justify-between gap-3 px-3 py-2.5 border-b border-gray-800/90
                   text-left transition hover:bg-gray-800/40"
        aria-label={collapsed ? 'Expand legend panel' : 'Collapse legend panel'}
        title={collapsed ? 'Expand' : 'Collapse'}
      >
        <div>
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">
            Map Context
          </p>
          <p className="text-[10px] text-gray-600 mt-0.5">
            Flood legend and exposure layers
          </p>
        </div>
        <span className="text-gray-500">
          {collapsed ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />}
        </span>
      </button>

      {!collapsed && (
        <div className="p-3">
          <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-2.5">
            {overlayLegend?.title || 'Flood Risk'}
          </p>

          {overlayLegend?.subtitle && (
            <p className="text-[10px] text-gray-500 leading-tight mb-2.5">
              {overlayLegend.subtitle}
            </p>
          )}

          {overlayLegend?.type === 'gradient' ? (
            <div className="space-y-2">
              <div
                className="h-3 rounded-md border border-gray-700"
                style={{ background: overlayLegend.gradient }}
              />
              <div className="flex justify-between text-[10px] text-gray-500 tabular-nums">
                <span>{overlayLegend.min_label}</span>
                <span>{overlayLegend.max_label}</span>
              </div>
            </div>
          ) : overlayLegend?.type === 'categories' ? (
            <div className="space-y-1.5">
              {overlayLegend.items.map(item => (
                <div key={item.label} className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-sm shrink-0"
                    style={{ background: item.color, boxShadow: `0 0 5px ${item.color}70` }}
                  />
                  <span className="text-[11px] font-medium text-gray-200">{item.label}</span>
                  <span className="text-[10px] text-gray-500 ml-auto tabular-nums">{item.range}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-1.5">
              {TIERS.map(t => (
                <div key={t.tier} className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-sm shrink-0"
                    style={{ background: t.color, boxShadow: `0 0 5px ${t.color}70` }}
                  />
                  <span className="text-[11px] font-medium text-gray-200">{t.tier}</span>
                  <span className="text-[10px] text-gray-500 ml-auto tabular-nums">{t.range}</span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-2.5 pt-2 border-t border-gray-800">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-blue-400 shrink-0 shadow-[0_0_5px_#60a5fa70]" />
              <span className="text-[10px] text-gray-500">Gauge station</span>
            </div>
            {isOverlayLegend && (
              <p className="text-[10px] text-gray-500 leading-tight mt-2">
                Overlay legend follows the selected satellite layer.
              </p>
            )}
          </div>

          {exposureLayers.length > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-800 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">
                  Exposure Layers
                </p>
                <span className="text-[10px] text-gray-600">OSM</span>
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
                        : 'border-gray-800 bg-gray-800/40 hover:border-gray-700 hover:bg-gray-800/70'
                    )}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className={clsx(
                        'text-[11px] font-medium',
                        exposureVisibility[layer.id] ? 'text-white' : 'text-gray-300'
                      )}>
                        {layer.label}
                      </span>
                      <span className={clsx(
                        'text-[10px]',
                        exposureVisibility[layer.id] ? 'text-blue-200' : 'text-gray-500'
                      )}>
                        {layer.feature_count?.toLocaleString?.() ?? layer.feature_count}
                      </span>
                    </div>

                    <p className="mt-1 text-[10px] leading-tight text-gray-500">
                      {layer.description}
                    </p>
                  </button>
                ))}
              </div>

              <p className="text-[10px] text-gray-500 leading-tight">
                Adds roads, bridges, and settlements for impact context.
              </p>

              {visibleExposureLayers.length > 0 && (
                <div className="pt-2 border-t border-gray-800 space-y-2">
                  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">
                    Exposure Symbology
                  </p>

                  {visibleExposureLayers.map(layer => (
                    <div key={`${layer.id}-symbols`} className="space-y-1">
                      <p className="text-[10px] font-medium text-gray-400">
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
                                  height: symbol.dash ? 2 : 2,
                                }}
                              />
                            ) : (
                              <span
                                className="h-2.5 w-2.5 rounded-full shrink-0"
                                style={{
                                  background: symbol.color,
                                  border: `1.2px solid ${symbol.stroke || symbol.color}`,
                                  boxShadow: `0 0 5px ${symbol.color}55`,
                                }}
                              />
                            )}
                            <span className="text-[10px] text-gray-400">{symbol.label}</span>
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
