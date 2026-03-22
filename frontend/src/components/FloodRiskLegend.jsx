import React from 'react'

const TIERS = [
  { tier: 'Emergency', color: '#ef4444', range: '> 75%' },
  { tier: 'Warning',   color: '#f97316', range: '50–75%' },
  { tier: 'Watch',     color: '#eab308', range: '25–50%' },
  { tier: 'Normal',    color: '#22c55e', range: '< 25%' },
]

export default function FloodRiskLegend() {
  return (
    <div className="bg-gray-900/90 backdrop-blur border border-gray-700/80
                    rounded-lg shadow-xl p-3 w-40">
      <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-2.5">
        Flood Risk
      </p>
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
      <div className="mt-2.5 pt-2 border-t border-gray-800">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-blue-400 shrink-0
                           shadow-[0_0_5px_#60a5fa70]" />
          <span className="text-[10px] text-gray-500">Gauge station</span>
        </div>
      </div>
    </div>
  )
}
