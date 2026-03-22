import React from 'react'
import clsx from 'clsx'

export default function RiskLayerControl({
  visible, opacity, onToggle, onOpacity,
  tileLayers = [], activeTile, onTileLayer,
}) {
  return (
    <div className="bg-gray-900/90 backdrop-blur border border-gray-700 rounded-xl
                    shadow-xl p-3 space-y-2 w-52">
      {/* Header + toggle */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-300 uppercase tracking-wide">
          Flood Risk Layer
        </span>
        <button
          onClick={onToggle}
          className={clsx(
            'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full',
            'transition-colors duration-200',
            visible ? 'bg-blue-600' : 'bg-gray-600'
          )}
        >
          <span className={clsx(
            'inline-block h-4 w-4 rounded-full bg-white shadow transform transition',
            'translate-y-0.5',
            visible ? 'translate-x-4' : 'translate-x-0.5'
          )} />
        </button>
      </div>

      {visible && (
        <>
          {/* Opacity slider */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-gray-400">
              <span>Opacity</span>
              <span>{Math.round(opacity * 100)}%</span>
            </div>
            <input
              type="range" min="0.1" max="1" step="0.05"
              value={opacity}
              onChange={e => onOpacity(parseFloat(e.target.value))}
              className="w-full h-1.5 accent-blue-500 cursor-pointer"
            />
          </div>

          {/* Satellite overlay selector */}
          {tileLayers.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                Satellite Overlay
              </p>
              <div className="space-y-0.5 max-h-28 overflow-y-auto pr-0.5">
                {/* None option */}
                <button
                  onClick={() => onTileLayer(null)}
                  className={clsx(
                    'w-full text-left text-[11px] px-2 py-1 rounded-md transition',
                    activeTile === null
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:bg-gray-700 hover:text-gray-200'
                  )}
                >
                  None
                </button>
                {tileLayers.map(l => (
                  <button
                    key={l.id}
                    onClick={() => onTileLayer(String(l.id))}
                    className={clsx(
                      'w-full text-left text-[11px] px-2 py-1 rounded-md transition leading-tight',
                      String(activeTile) === String(l.id)
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-400 hover:bg-gray-700 hover:text-gray-200'
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

      <p className="text-[10px] text-gray-500 leading-tight">
        Click any area for risk details.
      </p>
    </div>
  )
}
