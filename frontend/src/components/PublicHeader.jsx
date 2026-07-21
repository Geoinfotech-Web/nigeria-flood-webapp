import React from 'react'
import clsx from 'clsx'
import SearchBar from './SearchBar'
import { IconLocate, IconMoon, IconSun, IconWaves } from './Icons'

export default function PublicHeader({
  theme,
  onThemeChange,
  onPlaceSelect,
  mode,
  onModeChange,
  stationCount,
  onDetectLocation,
  locating = false,
  locationError = null,
}) {
  const dark = theme === 'dark'

  return (
    <header
      className={clsx(
        'relative z-20 shrink-0 border-b pt-[env(safe-area-inset-top)]',
        dark ? 'border-gray-800 bg-gray-950/90' : 'border-slate-200/80 bg-white/90',
        'backdrop-blur-md',
      )}
    >
      <div
        className={clsx(
          'pointer-events-none absolute inset-x-0 top-0 h-16 opacity-80',
          dark
            ? 'bg-gradient-to-b from-sky-950/50 to-transparent'
            : 'bg-gradient-to-b from-sky-100/70 via-cyan-50/40 to-transparent',
        )}
      />

      <div className="relative flex w-full flex-col gap-2 px-3 py-2.5 sm:gap-0 sm:px-4 sm:py-2.5">
        {/* Row 1: brand + mode + theme (search moves to row 2 on phones) */}
        <div className="flex w-full items-center gap-2 sm:gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3 sm:flex-none sm:shrink-0">
            <div
              className={clsx(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border sm:h-10 sm:w-10',
                dark
                  ? 'border-sky-500/30 bg-sky-500/10 text-sky-300'
                  : 'border-sky-200 bg-sky-50 text-sky-700',
              )}
            >
              <IconWaves size={18} />
            </div>
            <div className="min-w-0">
              <h1 className="font-display truncate text-sm font-semibold tracking-tight sm:text-lg">
                <span className="sm:hidden">GGIS Flood</span>
                <span className="hidden sm:inline">GGIS Flood Watch</span>
              </h1>
              <p
                className={clsx(
                  'hidden truncate text-[11px] lg:block',
                  dark ? 'text-gray-400' : 'text-slate-500',
                )}
              >
                {mode === 'expert'
                  ? `Gauge console · place exposure · forecasts · ${stationCount} gauges`
                  : `Public early warning · 72-hour forecasts · ${stationCount} gauges`}
              </p>
            </div>
          </div>

          {/* Desktop search — mid column */}
          <div className="mx-auto hidden min-w-0 w-full max-w-md flex-1 items-center gap-2 sm:flex">
            <div className="min-w-0 flex-1">
              <SearchBar
                onResult={onPlaceSelect}
                theme={theme}
                size="md"
                placeholder="Search a city, town, or state…"
              />
            </div>
            {onDetectLocation && (
              <button
                type="button"
                onClick={onDetectLocation}
                disabled={locating}
                className={clsx(
                  'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border shadow-sm transition',
                  locating && 'opacity-70',
                  dark
                    ? 'border-gray-700 bg-gray-900 text-sky-300 hover:bg-gray-800'
                    : 'border-slate-200 bg-white text-sky-700 hover:border-slate-300',
                )}
                aria-label="Use my location"
                title="Use my location"
              >
                {locating ? (
                  <span
                    className={clsx(
                      'h-4 w-4 rounded-full border-2 animate-spin',
                      dark ? 'border-gray-600 border-t-sky-400' : 'border-slate-300 border-t-sky-600',
                    )}
                  />
                ) : (
                  <IconLocate size={16} />
                )}
              </button>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <div
              className={clsx(
                'hidden items-center gap-1.5 rounded-full border px-2.5 py-1 md:inline-flex',
                dark
                  ? 'border-teal-800/60 bg-teal-950/50 text-teal-300'
                  : 'border-teal-200 bg-teal-50 text-teal-800',
              )}
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-500" />
              <span className="text-[11px] font-medium">Live</span>
            </div>

            <div
              className={clsx(
                'inline-flex rounded-lg border p-0.5',
                dark ? 'border-gray-700 bg-gray-900' : 'border-slate-200 bg-slate-100',
              )}
            >
              {[
                { id: 'public', label: 'Public' },
                { id: 'expert', label: 'Expert' },
              ].map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onModeChange(id)}
                  className={clsx(
                    'rounded-md px-2 py-1.5 text-[11px] font-semibold transition sm:px-2.5 sm:py-1',
                    mode === id
                      ? dark
                        ? 'bg-sky-600 text-white'
                        : 'bg-sky-700 text-white'
                      : dark
                        ? 'text-gray-400 hover:text-white'
                        : 'text-slate-500 hover:text-slate-900',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => onThemeChange(dark ? 'light' : 'dark')}
              className={clsx(
                'inline-flex h-9 w-9 items-center justify-center rounded-lg border transition sm:h-8 sm:w-8',
                dark
                  ? 'border-gray-700 text-gray-300 hover:bg-gray-800'
                  : 'border-slate-200 text-slate-600 hover:bg-white',
              )}
              aria-label="Toggle theme"
              title="Toggle theme"
            >
              {dark ? <IconSun size={14} /> : <IconMoon size={14} />}
            </button>
          </div>
        </div>

        {/* Row 2: full-width search on phones */}
        <div className="flex items-center gap-2 sm:hidden">
          <div className="min-w-0 flex-1">
            <SearchBar
              onResult={onPlaceSelect}
              theme={theme}
              size="md"
              placeholder="Search city or town…"
            />
          </div>
          {onDetectLocation && (
            <button
              type="button"
              onClick={onDetectLocation}
              disabled={locating}
              className={clsx(
                'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border shadow-sm transition',
                locating && 'opacity-70',
                dark
                  ? 'border-gray-700 bg-gray-900 text-sky-300 hover:bg-gray-800'
                  : 'border-slate-200 bg-white text-sky-700 hover:border-slate-300',
              )}
              aria-label="Use my location"
              title="Use my location"
            >
              {locating ? (
                <span
                  className={clsx(
                    'h-4 w-4 rounded-full border-2 animate-spin',
                    dark ? 'border-gray-600 border-t-sky-400' : 'border-slate-300 border-t-sky-600',
                  )}
                />
              ) : (
                <IconLocate size={16} />
              )}
            </button>
          )}
        </div>

        {locationError && (
          <p
            className={clsx(
              'text-[11px]',
              dark ? 'text-amber-300/90' : 'text-amber-800',
            )}
          >
            {locationError}
          </p>
        )}
      </div>
    </header>
  )
}
