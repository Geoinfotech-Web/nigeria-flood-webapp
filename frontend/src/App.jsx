import React, { useState } from 'react'
import MapPanel from './components/MapPanel'
import StationList from './components/StationList'
import GaugeChart from './components/GaugeChart'
import RainfallChart from './components/RainfallChart'
import AlertBanner from './components/AlertBanner'
import PredictionPanel from './components/PredictionPanel'
import { IconWaves } from './components/Icons'
import { useGaugeFeed } from './hooks/useGaugeFeed'
import { useStations } from './hooks/useStations'

export default function App() {
  const { stations } = useStations()
  const liveReadings = useGaugeFeed()
  const [selected, setSelected] = useState(null)

  const selectedStation = stations.find(s => s.id === selected)

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-gray-100">

      {/* ── Header ── */}
      <header className="relative flex items-center justify-between px-6 py-3
                         bg-gray-900 border-b border-gray-800 shrink-0">
        {/* thin accent bar at top */}
        <div className="absolute inset-x-0 top-0 h-[2px]
                        bg-gradient-to-r from-blue-600 via-cyan-400 to-blue-600" />

        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg
                          bg-blue-600/20 border border-blue-500/30 text-blue-400">
            <IconWaves size={17} />
          </div>
          <div>
            <h1 className="text-[15px] font-semibold tracking-tight leading-tight text-white">
              Nigeria Flood Prediction Dashboard
            </h1>
            <p className="text-[11px] text-gray-500 mt-0.5">
              72-hour forecast &middot; {stations.length} gauge stations
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full
                        bg-green-950/60 border border-green-800/50">
          <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
          <span className="text-[11px] font-medium text-green-400">Live</span>
        </div>
      </header>

      <AlertBanner />

      {/* ── Main layout ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left: station list */}
        <aside className="w-60 shrink-0 border-r border-gray-800 overflow-y-auto bg-gray-900/60">
          <StationList
            stations={stations}
            liveReadings={liveReadings}
            selected={selected}
            onSelect={setSelected}
          />
        </aside>

        {/* Centre: map */}
        <main className="flex-1 relative">
          <MapPanel
            stations={stations}
            liveReadings={liveReadings}
            selected={selected}
            onSelect={setSelected}
          />
        </main>

        {/* Right: detail panel */}
        {selectedStation && (
          <aside className="w-76 shrink-0 border-l border-gray-800 overflow-y-auto
                            bg-gray-900/60">
            {/* Station header */}
            <div className="px-4 pt-4 pb-3 border-b border-gray-800">
              <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-1">
                Selected Station
              </p>
              <h2 className="text-sm font-semibold text-white leading-tight">
                {selectedStation.name}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {selectedStation.river} &middot; {selectedStation.state}
              </p>
            </div>

            <div className="p-4 space-y-5">
              <PredictionPanel stationId={selected} />
              <div className="border-t border-gray-800" />
              <GaugeChart stationId={selected} />
              <div className="border-t border-gray-800" />
              <RainfallChart />
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
