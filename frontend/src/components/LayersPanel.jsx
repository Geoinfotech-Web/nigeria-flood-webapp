import React, { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { IconLayers } from './Icons'

function Toggle({ on, onToggle, theme, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={clsx(
        'relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors duration-200',
        disabled ? 'cursor-not-allowed opacity-45' : 'cursor-pointer',
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

function Row({ label, on, onToggle, theme, children, hint = null, disabled = false }) {
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
          {hint ? (
            <p
              className={clsx(
                'mt-0.5 text-[10px] leading-snug',
                theme === 'dark' ? 'text-gray-500' : 'text-slate-500',
              )}
            >
              {hint}
            </p>
          ) : null}
        </div>
        <Toggle on={on} onToggle={onToggle} theme={theme} disabled={disabled} />
      </div>
      {on && !disabled && children}
    </div>
  )
}

function statusHint(status, readyHint = null) {
  if (status === 'loading') return 'Loading layer…'
  if (status === 'empty') return 'No current data'
  if (status === 'error') return 'Layer unavailable'
  return readyHint
}

function Section({ title, theme, children }) {
  return (
    <div
      className={clsx(
        'space-y-3 border-t pt-3 first:border-t-0 first:pt-0',
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
  riskAreasVisible,
  onToggleRiskAreas,
  riskOpacity,
  onRiskOpacity,
  riskAreasStatus = 'ready',
  riskAreasHint = null,
  urbanFlashVisible = false,
  onToggleUrbanFlash,
  urbanFlashOpacity = 0.6,
  onUrbanFlashOpacity,
  urbanFlashStatus = 'ready',
  historicalHotspotsVisible = false,
  onToggleHistoricalHotspots,
  historicalHotspotsStatus = 'ready',
  atRiskPlacesVisible = false,
  onToggleAtRiskPlaces,
  tileLayers = [],
  tileLayersStatus = 'ready',
  tileVisibility = {},
  onToggleTile,
  gaugesVisible,
  onToggleGauges,
  newsVisible = false,
  onToggleNews,
  showNewsControl = true,
  exposureLayers = [],
  exposureVisibility = {},
  onToggleExposure,
  boundaryLayers = [],
  boundaryVisibility = {},
  onToggleBoundary,
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const dark = theme === 'dark'

  useEffect(() => {
    if (!open) return undefined
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative z-20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Map layers"
        className={clsx(
          'inline-flex h-10 w-10 items-center justify-center rounded-xl border shadow-lg transition',
          dark
            ? 'border-gray-700 bg-gray-900 text-gray-200 hover:border-gray-500 hover:bg-gray-800 hover:text-white'
            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900',
        )}
        style={
          dark
            ? { backgroundColor: '#111827', borderColor: '#374151' }
            : { backgroundColor: '#ffffff', borderColor: '#cbd5e1' }
        }
        aria-label="Map layers"
        aria-expanded={open}
      >
        <IconLayers size={16} className={dark ? 'text-gray-300' : 'text-slate-600'} />
      </button>

      {open && (
        <div
          className={clsx(
            'absolute right-full top-0 mr-2 z-30 w-[min(15.5rem,calc(100vw-4.5rem))] overflow-hidden rounded-xl border shadow-2xl',
            dark ? 'border-gray-700 bg-gray-900' : 'border-slate-200 bg-white',
          )}
          style={
            dark
              ? { backgroundColor: '#111827', borderColor: '#374151' }
              : { backgroundColor: '#ffffff', borderColor: '#e2e8f0' }
          }
          role="dialog"
          aria-label="Map layers"
        >
          <div
            className={clsx(
              'border-b px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.18em]',
              dark ? 'border-gray-800 text-gray-400' : 'border-slate-100 text-slate-500',
            )}
          >
            Layers
          </div>
          <div className="max-h-[min(70vh,28rem)] space-y-3 overflow-y-auto p-3">
            <Section title="Flood risk" theme={theme}>
              <Row
                label="Inundation probability"
                on={riskAreasVisible}
                onToggle={onToggleRiskAreas}
                theme={theme}
                hint={riskAreasHint || statusHint(riskAreasStatus)}
                disabled={riskAreasStatus !== 'ready'}
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
                on={urbanFlashVisible}
                onToggle={onToggleUrbanFlash}
                theme={theme}
                hint={statusHint(urbanFlashStatus)}
                disabled={urbanFlashStatus !== 'ready'}
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

              <Row
                label="Flood Hotspot"
                on={historicalHotspotsVisible}
                onToggle={onToggleHistoricalHotspots}
                theme={theme}
                hint={statusHint(
                  historicalHotspotsStatus,
                  'Past events + live community reports',
                )}
                disabled={historicalHotspotsStatus !== 'ready'}
              />

              <Row
                label="Places at risk"
                on={atRiskPlacesVisible}
                onToggle={onToggleAtRiskPlaces}
                theme={theme}
              />

              {tileLayers.map((layer) => (
                <Row
                  key={layer.id}
                  label={layer.label}
                  on={Boolean(tileVisibility[layer.source])}
                  onToggle={() => onToggleTile?.(layer.source)}
                  theme={theme}
                  hint={layer.status === 'degraded' ? 'Metadata delayed; tiles load on demand' : null}
                />
              ))}
              {tileLayersStatus === 'loading' && (
                <p className={clsx('text-[10px]', dark ? 'text-gray-500' : 'text-slate-500')}>
                  Loading raster layers…
                </p>
              )}
              {tileLayersStatus === 'empty' && (
                <p className={clsx('text-[10px]', dark ? 'text-gray-500' : 'text-slate-500')}>
                  No raster layers registered.
                </p>
              )}
              {tileLayersStatus === 'error' && (
                <p className={clsx('text-[10px] text-rose-500')}>
                  Raster layers unavailable.
                </p>
              )}
            </Section>

            <Section title="Monitoring" theme={theme}>
              <Row
                label="Gauge stations"
                on={gaugesVisible}
                onToggle={onToggleGauges}
                theme={theme}
              />
              {showNewsControl && (
                <Row
                  label="Flood news reports"
                  on={newsVisible}
                  onToggle={onToggleNews}
                  theme={theme}
                />
              )}
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
                  on={Boolean(exposureVisibility[layer.id])}
                  onToggle={() => onToggleExposure?.(layer.id)}
                  theme={theme}
                />
              ))}
            </Section>
          </div>
        </div>
      )}
    </div>
  )
}
