import React, { useState } from 'react'
import clsx from 'clsx'
import { IconChevronDown, IconChevronUp } from './Icons'

/** Inundation probability — darker blue = higher chance. */
const PROBABILITY_ITEMS = [
  { label: 'Very High', color: '#1e3a8a' },
  { label: 'High', color: '#2563eb' },
  { label: 'Moderate', color: '#93c5fd' },
]

/** Urban flash flood — orange for likely, purple for highly likely. */
const URBAN_FLASH_ITEMS = [
  { label: 'Highly likely', color: '#86198f' },
  { label: 'Likely', color: '#f97316' },
]

/** JRC Landsat inundation history wet classes. */
const DEFAULT_HISTORY_ITEMS = [
  { label: '> 50%', color: '#6b21a8', range: 'Very frequent' },
  { label: '25–50%', color: '#9333ea', range: 'Frequent' },
  { label: '5–25%', color: '#c084fc', range: 'Occasional' },
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
  buildings: [
    { label: 'Highly Susceptible', color: '#800026', stroke: '#4a0016', type: 'circle' },
    { label: 'High', color: '#e31a1c', stroke: '#7f1d1d', type: 'circle' },
    { label: 'Moderate', color: '#fd8d3c', stroke: '#9a3412', type: 'circle' },
    { label: 'Low', color: '#ffffb2', stroke: '#a16207', type: 'circle' },
  ],
}

const BOUNDARY_SYMBOLS = {
  states: [{ label: 'State', color: '#0f766e', type: 'line' }],
  lgas: [{ label: 'LGA', color: '#64748b', type: 'line' }],
  basins: [{ label: 'River basins (HydroBASINS L7)', color: '#0369a1', type: 'line' }],
}

function SectionTitle({ children, theme }) {
  return (
    <p
      className={clsx(
        'mb-1.5 text-[10px] font-semibold uppercase tracking-widest',
        theme === 'dark' ? 'text-gray-500' : 'text-slate-500',
      )}
    >
      {children}
    </p>
  )
}

function CategoryItems({ items, theme }) {
  return (
    <div className="space-y-1.5">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2">
          <span
            className="h-3 w-3 shrink-0 rounded-sm"
            style={{ background: item.color }}
            aria-hidden
          />
          <span
            className={clsx(
              'text-[11px] font-medium',
              theme === 'dark' ? 'text-gray-200' : 'text-slate-800',
            )}
          >
            {item.label}
          </span>
          {item.range ? (
            <span
              className={clsx(
                'ml-auto text-[10px]',
                theme === 'dark' ? 'text-gray-500' : 'text-slate-500',
              )}
            >
              {item.range}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  )
}

export default function FloodRiskLegend({
  showProbability = false,
  showUrbanFlash = false,
  showHistory = false,
  historyLegend = null,
  susceptibilityLegend = null,
  visibleExposureIds = [],
  visibleBoundaryIds = [],
  showGauges = true,
  theme = 'dark',
}) {
  const [collapsed, setCollapsed] = useState(false)

  const historyItems =
    historyLegend?.type === 'categories' && historyLegend.items?.length
      ? historyLegend.items
      : DEFAULT_HISTORY_ITEMS

  const hasContent =
    showProbability ||
    showUrbanFlash ||
    showHistory ||
    susceptibilityLegend ||
    showGauges ||
    visibleExposureIds.length > 0 ||
    visibleBoundaryIds.length > 0

  if (!hasContent) return null

  return (
    <div
      className={clsx(
        'w-56 overflow-hidden rounded-lg border shadow-xl',
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
        <div className="space-y-3.5 p-3">
          {showProbability && (
            <div>
              <SectionTitle theme={theme}>Inundation probability</SectionTitle>
              <p
                className={clsx(
                  'mb-1.5 text-[10px] leading-snug',
                  theme === 'dark' ? 'text-gray-500' : 'text-slate-500',
                )}
              >
                Flood probability for riverine inundation. Darker = higher.
              </p>
              <CategoryItems items={PROBABILITY_ITEMS} theme={theme} />
            </div>
          )}

          {showUrbanFlash && (
            <div>
              <SectionTitle theme={theme}>Urban flash flood</SectionTitle>
              <p
                className={clsx(
                  'mb-1.5 text-[10px] leading-snug',
                  theme === 'dark' ? 'text-gray-500' : 'text-slate-500',
                )}
              >
                Short-range rainfall over built-up areas. Darker = higher chance.
              </p>
              <CategoryItems items={URBAN_FLASH_ITEMS} theme={theme} />
            </div>
          )}

          {showHistory && (
            <div>
              <SectionTitle theme={theme}>Inundation history</SectionTitle>
              <p
                className={clsx(
                  'mb-1.5 text-[10px] leading-snug',
                  theme === 'dark' ? 'text-gray-500' : 'text-slate-500',
                )}
              >
                % of time under water, JRC Landsat 1984–2021. Darker = flooded more often.
              </p>
              <CategoryItems items={historyItems} theme={theme} />
            </div>
          )}

          {susceptibilityLegend?.type === 'categories' && (
            <div>
              <SectionTitle theme={theme}>{susceptibilityLegend.title}</SectionTitle>
              <CategoryItems items={susceptibilityLegend.items} theme={theme} />
            </div>
          )}

          {showGauges && (
            <div className="flex items-center gap-2">
              <span
                className="h-3 w-3 shrink-0 rounded-full"
                style={{
                  background: '#22c55e',
                  border: '2px solid #ffffff',
                  boxShadow: '0 0 6px #22c55e',
                }}
                aria-hidden
              />
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

          {visibleBoundaryIds.map((layerId) => (
            <div key={`boundary-${layerId}`} className="space-y-1">
              <SectionTitle theme={theme}>
                {layerId === 'states'
                  ? 'States'
                  : layerId === 'lgas'
                    ? 'LGAs'
                    : layerId === 'basins'
                      ? 'River basins'
                      : layerId}
              </SectionTitle>
              {(BOUNDARY_SYMBOLS[layerId] || []).map((symbol) => (
                <div key={`${layerId}-${symbol.label}`} className="flex items-center gap-2">
                  <span
                    className="block w-5 shrink-0"
                    style={{
                      background: symbol.color,
                      borderRadius: 999,
                      height: 2,
                    }}
                  />
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

          {visibleExposureIds.map((layerId) => (
            <div key={layerId} className="space-y-1">
              <SectionTitle theme={theme}>{layerId}</SectionTitle>
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
