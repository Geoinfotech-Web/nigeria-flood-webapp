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
  visibleExposureIds = [],
  showGauges = true,
  showRiskAreas = true,
  theme = 'dark',
}) {
  const [collapsed, setCollapsed] = useState(false)
  const hasContent = showRiskAreas || showGauges || overlayLegend || visibleExposureIds.length > 0

  if (!hasContent) return null

  return (
    <div
      className={clsx(
        'w-52 overflow-hidden rounded-lg border shadow-xl',
        theme === 'dark' ? 'bg-gray-900/90 border-gray-700/80 backdrop-blur' : 'bg-white border-slate-200',
      )}
    >
      <button
        type="button"
        onClick={() => setCollapsed((current) => !current)}
        className={clsx(
          'flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left transition',
          theme === 'dark' ? 'border-gray-800/90 hover:bg-gray-800/40' : 'border-slate-200 hover:bg-slate-50',
        )}
        aria-label={collapsed ? 'Expand legend' : 'Collapse legend'}
      >
        <p
          className={clsx(
            'text-[10px] font-semibold uppercase tracking-widest',
            theme === 'dark' ? 'text-gray-500' : 'text-slate-500',
          )}
        >
          Legend
        </p>
        <span className={theme === 'dark' ? 'text-gray-500' : 'text-slate-500'}>
          {collapsed ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />}
        </span>
      </button>

      {!collapsed && (
        <div className="space-y-3 p-3">
          {(showRiskAreas || overlayLegend) && (
            <div>
              <p
                className={clsx(
                  'mb-2 text-[10px] font-semibold uppercase tracking-widest',
                  theme === 'dark' ? 'text-gray-500' : 'text-slate-500',
                )}
              >
                {overlayLegend?.title || 'Flood risk'}
              </p>

              {overlayLegend?.type === 'gradient' ? (
                <div className="space-y-2">
                  <div
                    className={clsx(
                      'h-3 rounded-md border',
                      theme === 'dark' ? 'border-gray-700' : 'border-slate-200',
                    )}
                    style={{ background: overlayLegend.gradient }}
                  />
                  <div
                    className={clsx(
                      'flex justify-between text-[10px] tabular-nums',
                      theme === 'dark' ? 'text-gray-500' : 'text-slate-500',
                    )}
                  >
                    <span>{overlayLegend.min_label}</span>
                    <span>{overlayLegend.max_label}</span>
                  </div>
                </div>
              ) : overlayLegend?.type === 'categories' ? (
                <div className="space-y-1.5">
                  {overlayLegend.items.map((item) => (
                    <div key={item.label} className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ background: item.color }}
                      />
                      <span
                        className={clsx(
                          'text-[11px] font-medium',
                          theme === 'dark' ? 'text-gray-200' : 'text-slate-800',
                        )}
                      >
                        {item.label}
                      </span>
                      <span
                        className={clsx(
                          'ml-auto text-[10px] tabular-nums',
                          theme === 'dark' ? 'text-gray-500' : 'text-slate-500',
                        )}
                      >
                        {item.range}
                      </span>
                    </div>
                  ))}
                </div>
              ) : showRiskAreas ? (
                <div className="space-y-1.5">
                  {TIERS.map((t) => (
                    <div key={t.tier} className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ background: t.color }}
                      />
                      <span
                        className={clsx(
                          'text-[11px] font-medium',
                          theme === 'dark' ? 'text-gray-200' : 'text-slate-800',
                        )}
                      >
                        {t.tier}
                      </span>
                      <span
                        className={clsx(
                          'ml-auto text-[10px] tabular-nums',
                          theme === 'dark' ? 'text-gray-500' : 'text-slate-500',
                        )}
                      >
                        {t.range}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )}

          {showGauges && (
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-sky-500" />
              <span
                className={clsx(
                  'text-[11px]',
                  theme === 'dark' ? 'text-gray-300' : 'text-slate-700',
                )}
              >
                Gauge station
              </span>
            </div>
          )}

          {visibleExposureIds.map((layerId) => (
            <div key={layerId} className="space-y-1">
              <p
                className={clsx(
                  'text-[10px] font-semibold uppercase tracking-widest',
                  theme === 'dark' ? 'text-gray-500' : 'text-slate-500',
                )}
              >
                {layerId}
              </p>
              {(EXPOSURE_SYMBOLS[layerId] || []).map((symbol) => (
                <div key={`${layerId}-${symbol.label}`} className="flex items-center gap-2">
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
                      }}
                    />
                  )}
                  <span
                    className={clsx(
                      'text-[10px]',
                      theme === 'dark' ? 'text-gray-400' : 'text-slate-500',
                    )}
                  >
                    {symbol.label}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
