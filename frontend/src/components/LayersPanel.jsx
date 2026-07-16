import React, { useState } from 'react'
import clsx from 'clsx'
import { IconChevronDown, IconChevronUp, IconLayers } from './Icons'

function Toggle({ on, onToggle, theme }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={clsx(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200',
        on ? 'bg-sky-600' : theme === 'dark' ? 'bg-gray-600' : 'bg-slate-300',
      )}
      role="switch"
      aria-checked={on}
    >
      <span
        className={clsx(
          'inline-block h-4 w-4 translate-y-0.5 rounded-full bg-white shadow transition',
          on ? 'translate-x-4' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

function Row({ label, hint, on, onToggle, theme, children }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p
            className={clsx(
              'text-[12px] font-medium leading-tight',
              theme === 'dark' ? 'text-gray-200' : 'text-slate-800',
            )}
          >
            {label}
          </p>
          {hint && (
            <p
              className={clsx(
                'mt-0.5 text-[10px] leading-tight',
                theme === 'dark' ? 'text-gray-500' : 'text-slate-500',
              )}
            >
              {hint}
            </p>
          )}
        </div>
        <Toggle on={on} onToggle={onToggle} theme={theme} />
      </div>
      {on && children}
    </div>
  )
}

function Section({ title, theme, children }) {
  return (
    <div
      className={clsx(
        'space-y-3 border-t pt-3',
        theme === 'dark' ? 'border-gray-800' : 'border-slate-200',
      )}
    >
      <p
        className={clsx(
          'text-[10px] font-semibold uppercase tracking-widest',
          theme === 'dark' ? 'text-gray-500' : 'text-slate-500',
        )}
      >
        {title}
      </p>
      {children}
    </div>
  )
}

export default function LayersPanel({
  theme = 'light',
  // Flood risk areas (vector inundation probability)
  riskAreasVisible,
  onToggleRiskAreas,
  riskOpacity,
  onRiskOpacity,
  // Urban flash flood (separate short-range vector layer)
  urbanFlashVisible = false,
  onToggleUrbanFlash,
  urbanFlashOpacity = 0.6,
  onUrbanFlashOpacity,
  // Independent raster overlays (history, susceptibility, …)
  tileLayers = [],
  tileVisibility = {},
  onToggleTile,
  // Gauges
  gaugesVisible,
  onToggleGauges,
  // Exposure
  exposureLayers = [],
  exposureVisibility = {},
  onToggleExposure,
  // Boundaries
  boundaryLayers = [],
  boundaryVisibility = {},
  onToggleBoundary,
}) {
  const [open, setOpen] = useState(true)
  const dark = theme === 'dark'

  return (
    <div
      className={clsx(
        'w-[15.5rem] overflow-hidden rounded-xl border shadow-xl',
        dark ? 'border-gray-700 bg-gray-900' : 'border-slate-200 bg-white',
      )}
      style={
        dark
          ? { backgroundColor: '#111827', borderColor: '#374151' }
          : { backgroundColor: '#ffffff', borderColor: '#e2e8f0' }
      }
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'flex w-full items-center justify-between gap-2 border-b px-3 py-2.5 text-left transition',
          dark ? 'border-gray-800 hover:bg-gray-800/50' : 'border-slate-100 hover:bg-slate-50',
        )}
        aria-expanded={open}
      >
        <span className="inline-flex items-center gap-2">
          <IconLayers size={14} className={dark ? 'text-sky-400' : 'text-sky-700'} />
          <span
            className={clsx(
              'text-xs font-semibold uppercase tracking-wide',
              dark ? 'text-gray-200' : 'text-slate-800',
            )}
          >
            Layers
          </span>
        </span>
        <span className={dark ? 'text-gray-500' : 'text-slate-400'}>
          {open ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />}
        </span>
      </button>

      {open && (
        <div className="max-h-[min(70vh,28rem)] space-y-3 overflow-y-auto p-3">
          <Section title="Flood risk" theme={theme}>
            <Row
              label="Inundation probability"
              hint="Vector extents — Very High / High / Moderate"
              on={riskAreasVisible}
              onToggle={onToggleRiskAreas}
              theme={theme}
            >
              <div className="space-y-1 pl-0.5">
                <div
                  className={clsx(
                    'flex justify-between text-[10px]',
                    dark ? 'text-gray-400' : 'text-slate-500',
                  )}
                >
                  <span>Opacity</span>
                  <span>{Math.round(riskOpacity * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.05"
                  value={riskOpacity}
                  onChange={(e) => onRiskOpacity(parseFloat(e.target.value))}
                  className="h-1.5 w-full cursor-pointer accent-sky-600"
                />
              </div>
            </Row>

            <Row
              label="Urban flash flood"
              hint="Short-range rainfall model — Likely / Highly likely"
              on={urbanFlashVisible}
              onToggle={onToggleUrbanFlash}
              theme={theme}
            >
              <div className="space-y-1 pl-0.5">
                <div
                  className={clsx(
                    'flex justify-between text-[10px]',
                    dark ? 'text-gray-400' : 'text-slate-500',
                  )}
                >
                  <span>Opacity</span>
                  <span>{Math.round(urbanFlashOpacity * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.05"
                  value={urbanFlashOpacity}
                  onChange={(e) => onUrbanFlashOpacity?.(parseFloat(e.target.value))}
                  className="h-1.5 w-full cursor-pointer accent-fuchsia-600"
                />
              </div>
            </Row>

            {tileLayers.map((layer) => (
              <Row
                key={layer.id}
                label={layer.label}
                hint={
                  layer.source === 'jrc_occurrence'
                    ? '3 wet classes · clipped to Nigeria'
                    : layer.legend?.subtitle || layer.source
                }
                on={Boolean(tileVisibility[layer.source])}
                onToggle={() => onToggleTile?.(layer.source)}
                theme={theme}
              />
            ))}
          </Section>

          <Section title="Monitoring" theme={theme}>
            <Row
              label="Gauge stations"
              hint="River level monitoring points"
              on={gaugesVisible}
              onToggle={onToggleGauges}
              theme={theme}
            />
          </Section>

          <Section title="Boundaries" theme={theme}>
            {boundaryLayers.length === 0 && (
              <p className={clsx('text-[10px]', dark ? 'text-gray-500' : 'text-slate-500')}>
                No boundary layers available.
              </p>
            )}
            {boundaryLayers.map((layer) => (
              <Row
                key={layer.id}
                label={layer.label}
                hint={
                  layer.feature_count != null
                    ? `${Number(layer.feature_count).toLocaleString()} areas`
                    : layer.description
                }
                on={Boolean(boundaryVisibility[layer.id])}
                onToggle={() => onToggleBoundary?.(layer.id)}
                theme={theme}
              />
            ))}
          </Section>

          <Section title="Exposure" theme={theme}>
            {exposureLayers.length === 0 && (
              <p className={clsx('text-[10px]', dark ? 'text-gray-500' : 'text-slate-500')}>
                No exposure layers available.
              </p>
            )}
            {exposureLayers.map((layer) => (
              <Row
                key={layer.id}
                label={layer.label}
                hint={
                  layer.feature_count != null
                    ? `${Number(layer.feature_count).toLocaleString()} features`
                    : layer.description
                }
                on={Boolean(exposureVisibility[layer.id])}
                onToggle={() => onToggleExposure?.(layer.id)}
                theme={theme}
              />
            ))}
          </Section>
        </div>
      )}
    </div>
  )
}
