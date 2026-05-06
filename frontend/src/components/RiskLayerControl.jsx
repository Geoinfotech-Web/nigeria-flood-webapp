import React from 'react'
import clsx from 'clsx'

export default function RiskLayerControl({
  visible, opacity, onToggle, onOpacity,
  tileLayers = [], activeTile, onTileLayer,
  theme = 'dark',
}) {
  return (
    <div
      className={clsx(
        'w-52 space-y-2 rounded-xl border p-3 shadow-xl',
        theme === 'dark' ? 'bg-gray-900/90 border-gray-700 backdrop-blur' : 'bg-white border-slate-200'
      )}
    >
      <div className="flex items-center justify-between">
        <span className={clsx('text-xs font-semibold uppercase tracking-wide', theme === 'dark' ? 'text-gray-300' : 'text-slate-700')}>
          Flood Risk Layer
        </span>
        <button
          onClick={onToggle}
          className={clsx(
            'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors duration-200',
            visible ? 'bg-blue-600' : theme === 'dark' ? 'bg-gray-600' : 'bg-slate-300'
          )}
        >
          <span
            className={clsx(
              'inline-block h-4 w-4 translate-y-0.5 rounded-full bg-white shadow transition',
              visible ? 'translate-x-4' : 'translate-x-0.5'
            )}
          />
        </button>
      </div>

      {visible && (
        <>
          <div className="space-y-1">
            <div className={clsx('flex justify-between text-xs', theme === 'dark' ? 'text-gray-400' : 'text-slate-500')}>
              <span>Opacity</span>
              <span>{Math.round(opacity * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={opacity}
              onChange={e => onOpacity(parseFloat(e.target.value))}
              className="h-1.5 w-full cursor-pointer accent-blue-500"
            />
          </div>

          {tileLayers.length > 0 && (
            <div className="space-y-1">
              <p className={clsx('text-[10px] font-semibold uppercase tracking-wide', theme === 'dark' ? 'text-gray-400' : 'text-slate-500')}>
                Satellite Overlay
              </p>
              <div className="max-h-28 space-y-0.5 overflow-y-auto pr-0.5">
                <button
                  onClick={() => onTileLayer(null)}
                  className={clsx(
                    'w-full rounded-md px-2 py-1 text-left text-[11px] transition',
                    activeTile === null
                      ? 'bg-blue-600 text-white'
                      : theme === 'dark'
                        ? 'text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                  )}
                >
                  None
                </button>
                {tileLayers.map(l => (
                  <button
                    key={l.id}
                    onClick={() => onTileLayer(String(l.id))}
                    className={clsx(
                      'w-full rounded-md px-2 py-1 text-left text-[11px] leading-tight transition',
                      String(activeTile) === String(l.id)
                        ? 'bg-blue-600 text-white'
                        : theme === 'dark'
                          ? 'text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                    )}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <p className={clsx('text-[10px] leading-tight', theme === 'dark' ? 'text-gray-500' : 'text-slate-500')}>
        Click any area for risk details.
      </p>
    </div>
  )
}
