import React, { useState } from 'react'
import clsx from 'clsx'
import MapPanel from './components/MapPanel'
import StationList from './components/StationList'
import GaugeChart from './components/GaugeChart'
import RainfallChart from './components/RainfallChart'
import AlertBanner from './components/AlertBanner'
import PredictionPanel from './components/PredictionPanel'
import { IconMoon, IconSun, IconWaves, IconX } from './components/Icons'
import { useGaugeFeed } from './hooks/useGaugeFeed'
import { useStations } from './hooks/useStations'

export default function App() {
  const { stations } = useStations()
  const liveReadings = useGaugeFeed()
  const [theme, setTheme] = useState('dark')
  const [basemap, setBasemap] = useState('dark')
  const [selected, setSelected] = useState(null)

  const clearSelectedStation = () => setSelected(null)
  const handleSelectStation = (stationId) => {
    setSelected(current => (current === stationId ? null : stationId))
  }

  const selectedStation = stations.find(s => s.id === selected)

  return (
    <div
      className={clsx(
        'flex h-screen flex-col transition-colors',
        theme === 'dark' ? 'bg-gray-950 text-gray-100' : 'bg-slate-100 text-slate-900'
      )}
    >
      <header
        className={clsx(
          'relative flex items-center justify-between px-6 py-3 shrink-0 border-b',
          theme === 'dark' ? 'bg-gray-900 border-gray-800' : 'bg-white border-slate-200'
        )}
      >
        <div className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-blue-600 via-cyan-400 to-blue-600" />

        <div className="flex items-center gap-3">
          <div
            className={clsx(
              'flex h-8 w-8 items-center justify-center rounded-lg border text-blue-500',
              theme === 'dark' ? 'bg-blue-600/20 border-blue-500/30' : 'bg-blue-50 border-blue-200'
            )}
          >
            <IconWaves size={17} />
          </div>
          <div>
            <h1
              className={clsx(
                'text-[15px] font-semibold tracking-tight leading-tight',
                theme === 'dark' ? 'text-white' : 'text-slate-900'
              )}
            >
              Nigeria Flood Prediction Dashboard
            </h1>
            <p className={clsx('mt-0.5 text-[11px]', theme === 'dark' ? 'text-gray-500' : 'text-slate-500')}>
              72-hour forecast &middot; {stations.length} gauge stations
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div
            className={clsx(
              'inline-flex items-center rounded-xl border p-1 shadow-sm',
              theme === 'dark' ? 'border-gray-700/80 bg-gray-800/70' : 'border-slate-200 bg-slate-100'
            )}
          >
            {[
              { id: 'dark', label: 'Dark', Icon: IconMoon },
              { id: 'light', label: 'Light', Icon: IconSun },
            ].map(({ id, label, Icon }) => {
              const active = theme === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTheme(id)}
                  className={clsx(
                    'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition',
                    active
                      ? 'bg-blue-600 text-white shadow-sm'
                      : theme === 'dark'
                        ? 'text-gray-300 hover:bg-gray-700/80 hover:text-white'
                        : 'text-slate-600 hover:bg-white hover:text-slate-900'
                  )}
                  aria-pressed={active}
                  title={`Switch dashboard to ${label.toLowerCase()} theme`}
                >
                  <Icon size={13} />
                  <span>{label}</span>
                </button>
              )
            })}
          </div>

          <div className="flex items-center gap-2 rounded-full border border-green-800/50 bg-green-950/60 px-3 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="text-[11px] font-medium text-green-400">Live</span>
          </div>
        </div>
      </header>

      <AlertBanner theme={theme} />

      <div className="flex flex-1 overflow-hidden">
        <aside
          className={clsx(
            'w-60 shrink-0 overflow-y-auto border-r',
            theme === 'dark' ? 'border-gray-800 bg-gray-900/60' : 'border-slate-200 bg-white/90'
          )}
        >
          <StationList
            stations={stations}
            liveReadings={liveReadings}
            selected={selected}
            onSelect={handleSelectStation}
            onReset={clearSelectedStation}
            theme={theme}
          />
        </aside>

        <main className="relative flex-1">
          <MapPanel
            stations={stations}
            liveReadings={liveReadings}
            selected={selected}
            onSelect={handleSelectStation}
            basemap={basemap}
            onBasemapChange={setBasemap}
            theme={theme}
          />
        </main>

        {selectedStation && (
          <aside
            className={clsx(
              'w-[24rem] shrink-0 overflow-y-auto border-l',
              theme === 'dark' ? 'border-gray-800 bg-gray-900/60' : 'border-slate-200 bg-white/95'
            )}
          >
            <div className={clsx('border-b px-4 pt-4 pb-3', theme === 'dark' ? 'border-gray-800' : 'border-slate-200')}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p
                    className={clsx(
                      'mb-1 text-[10px] font-semibold uppercase tracking-widest',
                      theme === 'dark' ? 'text-gray-500' : 'text-slate-500'
                    )}
                  >
                    Selected Station
                  </p>
                  <h2 className={clsx('text-sm font-semibold leading-tight', theme === 'dark' ? 'text-white' : 'text-slate-900')}>
                    {selectedStation.name}
                  </h2>
                  <p className={clsx('mt-0.5 text-xs', theme === 'dark' ? 'text-gray-400' : 'text-slate-500')}>
                    {selectedStation.river} &middot; {selectedStation.state}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={clearSelectedStation}
                  className={clsx(
                    'inline-flex h-8 w-8 items-center justify-center rounded-lg border transition',
                    theme === 'dark'
                      ? 'border-gray-700/70 bg-gray-800/70 text-gray-400 hover:border-gray-600 hover:bg-gray-800 hover:text-white'
                      : 'border-slate-200 bg-slate-100 text-slate-500 hover:border-slate-300 hover:bg-white hover:text-slate-900'
                  )}
                  aria-label="Close selected station panel"
                  title="Close panel"
                >
                  <IconX size={14} />
                </button>
              </div>
            </div>

            <div className="space-y-5 p-4">
              <PredictionPanel stationId={selected} theme={theme} />
              <div className={clsx('border-t', theme === 'dark' ? 'border-gray-800' : 'border-slate-200')} />
              <GaugeChart stationId={selected} theme={theme} />
              <div className={clsx('border-t', theme === 'dark' ? 'border-gray-800' : 'border-slate-200')} />
              <RainfallChart theme={theme} />
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
