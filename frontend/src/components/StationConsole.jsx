import React, { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import clsx from 'clsx'
import ReactECharts from 'echarts-for-react'
import { format } from 'date-fns'
import { IconX } from './Icons'
import GaugeChart from './GaugeChart'
import RainfallChart from './RainfallChart'
import PredictionPanel from './PredictionPanel'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'forecast', label: 'Forecast' },
  { id: 'rainfall', label: 'Rainfall' },
  { id: 'historical', label: 'Historical' },
  { id: 'info', label: 'Info' },
]

const RISK_BANNER = {
  dark: {
    Normal: 'border-emerald-800 bg-emerald-950/50 text-emerald-300',
    Watch: 'border-amber-800 bg-amber-950/50 text-amber-300',
    Warning: 'border-orange-800 bg-orange-950/50 text-orange-300',
    Emergency: 'border-red-800 bg-red-950/50 text-red-300',
  },
  light: {
    Normal: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    Watch: 'border-amber-200 bg-amber-50 text-amber-800',
    Warning: 'border-orange-200 bg-orange-50 text-orange-800',
    Emergency: 'border-red-200 bg-red-50 text-red-800',
  },
}

function timeAgo(iso) {
  if (!iso) return null
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`
  return `${Math.floor(mins / 1440)}d ago`
}

function probLabel(p) {
  if (p == null) return '—'
  const pct = p <= 1 ? p * 100 : p
  if (pct >= 80) return 'Very High'
  if (pct >= 60) return 'High'
  if (pct >= 40) return 'Moderate'
  if (pct >= 20) return 'Low'
  return 'Very Low'
}

function TrendArrow({ delta, unit = 'm', invertGood = false }) {
  if (delta == null || !Number.isFinite(delta)) return null
  const rising = delta > 0.001
  const falling = delta < -0.001
  const color = rising
    ? invertGood
      ? 'text-emerald-500'
      : 'text-orange-500'
    : falling
      ? invertGood
        ? 'text-orange-500'
        : 'text-emerald-500'
      : 'text-slate-400'
  return (
    <span className={clsx('text-[10px] font-medium tabular-nums', color)}>
      {rising ? '↑' : falling ? '↓' : '→'} {Math.abs(delta).toFixed(2)} {unit}
    </span>
  )
}

function MetricCard({ label, value, sub, theme }) {
  const dark = theme === 'dark'
  return (
    <div
      className={clsx(
        'rounded-lg border px-2.5 py-2',
        dark ? 'border-gray-800 bg-gray-900/50' : 'border-slate-200 bg-slate-50',
      )}
    >
      <p className={clsx('text-[9px] uppercase tracking-wide', dark ? 'text-gray-500' : 'text-slate-500')}>
        {label}
      </p>
      <p
        className={clsx(
          'mt-0.5 text-sm font-bold tabular-nums',
          dark ? 'text-white' : 'text-slate-900',
        )}
      >
        {value}
      </p>
      {sub ? <div className="mt-0.5">{sub}</div> : null}
    </div>
  )
}

function FloodProbDonut({ probability, theme }) {
  const dark = theme === 'dark'
  const pct = probability == null ? 0 : probability <= 1 ? probability * 100 : probability
  const option = {
    backgroundColor: 'transparent',
    series: [
      {
        type: 'pie',
        radius: ['62%', '84%'],
        avoidLabelOverlap: false,
        label: { show: false },
        data: [
          {
            value: pct,
            itemStyle: { color: pct >= 80 ? '#ef4444' : pct >= 50 ? '#f97316' : '#3b82f6' },
          },
          {
            value: Math.max(0, 100 - pct),
            itemStyle: { color: dark ? '#1f2937' : '#e2e8f0' },
            tooltip: { show: false },
          },
        ],
      },
    ],
    graphic: [
      {
        type: 'text',
        left: 'center',
        top: 'middle',
        style: {
          text: `${pct.toFixed(0)}%`,
          fill: dark ? '#f3f4f6' : '#0f172a',
          fontSize: 16,
          fontWeight: 700,
          fontFamily: 'inherit',
        },
      },
    ],
  }
  return (
    <div
      className={clsx(
        'flex items-center gap-3 rounded-lg border px-3 py-2',
        dark ? 'border-gray-800 bg-gray-900/50' : 'border-slate-200 bg-slate-50',
      )}
    >
      <ReactECharts option={option} style={{ height: 72, width: 72 }} opts={{ renderer: 'svg' }} />
      <div className="min-w-0">
        <p className={clsx('text-[9px] uppercase tracking-wide', dark ? 'text-gray-500' : 'text-slate-500')}>
          Flood probability (peak)
        </p>
        <p className={clsx('text-sm font-semibold', dark ? 'text-white' : 'text-slate-900')}>
          {probLabel(probability)}
        </p>
      </div>
    </div>
  )
}

export default function StationConsole({
  station,
  stationId,
  liveReading = null,
  theme = 'light',
  onClose,
}) {
  const dark = theme === 'dark'
  const [tab, setTab] = useState('overview')
  const [prediction, setPrediction] = useState(null)
  const [readings24h, setReadings24h] = useState([])
  const [rainToday, setRainToday] = useState(null)

  useEffect(() => {
    setTab('overview')
  }, [stationId])

  useEffect(() => {
    if (!stationId) return undefined
    const loadPred = () =>
      axios
        .get(`${API}/stations/${stationId}/predictions`)
        .then((r) => setPrediction(r.data))
        .catch(() => setPrediction(null))
    const loadReadings = () =>
      axios
        .get(`${API}/stations/${stationId}/readings?hours=24`)
        .then((r) => setReadings24h(Array.isArray(r.data) ? r.data : []))
        .catch(() => setReadings24h([]))
    const loadRain = () =>
      axios
        .get(`${API}/stations/${stationId}/rainfall?days=1`)
        .then((r) => {
          const rows = Array.isArray(r.data) ? r.data : []
          const total = rows.reduce((a, row) => a + (Number(row.total_rain_mm) || 0), 0)
          setRainToday(total)
        })
        .catch(() => setRainToday(null))
    loadPred()
    loadReadings()
    loadRain()
    const id = setInterval(() => {
      loadPred()
      loadReadings()
      loadRain()
    }, 60_000)
    return () => clearInterval(id)
  }, [stationId])

  const overall = prediction?.overall_risk || liveReading?.risk_tier || 'Normal'
  const banner = (dark ? RISK_BANNER.dark : RISK_BANNER.light)[overall] || RISK_BANNER.light.Normal

  const level = liveReading?.water_level_m
  const bankFull = station?.bank_full_m ?? liveReading?.bank_full_m
  const pct =
    liveReading?.pct_bank != null
      ? Number(liveReading.pct_bank)
      : bankFull && level != null
        ? Math.round((level / bankFull) * 1000) / 10
        : null
  const flow = liveReading?.flow_rate_m3s

  const levelDelta1h = useMemo(() => {
    if (level == null || !readings24h.length) return null
    const now = liveReading?.time ? new Date(liveReading.time).getTime() : Date.now()
    const target = now - 60 * 60 * 1000
    let best = null
    let bestDist = Infinity
    for (const r of readings24h) {
      const t = new Date(r.time).getTime()
      const dist = Math.abs(t - target)
      if (dist < bestDist && r.water_level_m != null) {
        bestDist = dist
        best = r.water_level_m
      }
    }
    if (best == null || bestDist > 45 * 60 * 1000) return null
    return Number(level) - Number(best)
  }, [level, readings24h, liveReading?.time])

  const flowDelta = useMemo(() => {
    if (flow == null || readings24h.length < 2) return null
    const sorted = [...readings24h].sort(
      (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
    )
    const prev = sorted[sorted.length - 2]?.flow_rate_m3s
    if (prev == null) return null
    return Number(flow) - Number(prev)
  }, [flow, readings24h])

  const peakProb = useMemo(() => {
    const horizons = prediction?.horizons || {}
    let best = null
    for (const v of Object.values(horizons)) {
      const p = Number(v?.flood_prob)
      if (!Number.isFinite(p)) continue
      if (best == null || p > best) best = p
    }
    return best
  }, [prediction])

  const online = useMemo(() => {
    if (!liveReading?.time) return false
    return Date.now() - new Date(liveReading.time).getTime() < 15 * 60 * 1000
  }, [liveReading?.time])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={clsx(
          'shrink-0 border-b px-4 pt-3 pb-2',
          dark ? 'border-gray-800' : 'border-slate-200',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-0.5 flex items-center gap-2">
              <p
                className={clsx(
                  'text-[10px] font-semibold uppercase tracking-widest',
                  dark ? 'text-gray-500' : 'text-slate-500',
                )}
              >
                Station console
              </p>
              <span
                className={clsx(
                  'rounded-full px-1.5 py-0.5 text-[9px] font-semibold',
                  online
                    ? dark
                      ? 'bg-emerald-950 text-emerald-300'
                      : 'bg-emerald-50 text-emerald-700'
                    : dark
                      ? 'bg-gray-800 text-gray-400'
                      : 'bg-slate-100 text-slate-500',
                )}
              >
                {online ? 'Online' : 'Stale'}
              </span>
            </div>
            <h2
              className={clsx(
                'truncate text-sm font-semibold leading-tight',
                dark ? 'text-white' : 'text-slate-900',
              )}
            >
              {station.name}
            </h2>
            <p className={clsx('mt-0.5 text-xs', dark ? 'text-gray-400' : 'text-slate-500')}>
              {station.state} · {station.river}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={clsx(
              'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition',
              dark
                ? 'border-gray-700/70 bg-gray-800/70 text-gray-400 hover:text-white'
                : 'border-slate-200 bg-slate-100 text-slate-500 hover:text-slate-900',
            )}
            aria-label="Close selected station panel"
            title="Back to network overview"
          >
            <IconX size={14} />
          </button>
        </div>

        <div className="mt-2.5 flex gap-1 overflow-x-auto scrollbar-none">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={clsx(
                'rounded-md px-2.5 py-1 text-[11px] font-semibold transition',
                tab === t.id
                  ? dark
                    ? 'bg-sky-900/60 text-sky-200'
                    : 'bg-sky-100 text-sky-900'
                  : dark
                    ? 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {tab === 'overview' && (
          <>
            <div className={clsx('rounded-lg border px-3 py-2', banner)}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold tracking-wide">{overall.toUpperCase()}</span>
                <span className="text-[10px] opacity-80">
                  Updated {timeAgo(liveReading?.time) || '—'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              <MetricCard
                theme={theme}
                label="River Level"
                value={level != null ? `${Number(level).toFixed(2)} m` : '—'}
                sub={<TrendArrow delta={levelDelta1h} unit="m / 1h" />}
              />
              <MetricCard
                theme={theme}
                label="Bankfull"
                value={bankFull != null ? `${Number(bankFull).toFixed(2)} m` : '—'}
                sub={
                  pct != null ? (
                    <span className={clsx('text-[10px]', dark ? 'text-gray-400' : 'text-slate-500')}>
                      {pct}% capacity
                    </span>
                  ) : null
                }
              />
              <MetricCard
                theme={theme}
                label="Flow Rate"
                value={flow != null ? `${Number(flow).toFixed(0)} m³/s` : '—'}
                sub={
                  flowDelta != null ? (
                    <span
                      className={clsx(
                        'text-[10px] font-medium',
                        flowDelta > 0
                          ? 'text-orange-500'
                          : flowDelta < 0
                            ? 'text-emerald-500'
                            : dark
                              ? 'text-gray-500'
                              : 'text-slate-400',
                      )}
                    >
                      {flowDelta > 0.1 ? '↑ Rising' : flowDelta < -0.1 ? '↓ Falling' : '→ Steady'}
                    </span>
                  ) : null
                }
              />
            </div>

            <GaugeChart
              stationId={stationId}
              liveReading={liveReading}
              theme={theme}
              mode="readings"
              hours={24}
              title="Water Level — 24 Hours"
              height={150}
            />

            <FloodProbDonut probability={peakProb} theme={theme} />
          </>
        )}

        {tab === 'forecast' && (
          <PredictionPanel
            stationId={stationId}
            theme={theme}
            liveReading={liveReading}
            station={station}
            variant="forecastOnly"
          />
        )}

        {tab === 'rainfall' && (
          <>
            <div
              className={clsx(
                'rounded-lg border px-3 py-2',
                dark ? 'border-cyan-900/50 bg-cyan-950/30' : 'border-cyan-200 bg-cyan-50',
              )}
            >
              <p className={clsx('text-[9px] uppercase tracking-wide', dark ? 'text-cyan-400/80' : 'text-cyan-700')}>
                Rainfall last 24h (nearest met · model uses catchment-weighted IDW)
              </p>
              <p
                className={clsx(
                  'mt-0.5 font-display text-2xl font-semibold tabular-nums',
                  dark ? 'text-cyan-200' : 'text-cyan-900',
                )}
              >
                {rainToday != null ? `${rainToday.toFixed(1)} mm` : '—'}
              </p>
            </div>
            <RainfallChart
              stationId={stationId}
              stationName={station.name}
              theme={theme}
            />
          </>
        )}

        {tab === 'historical' && (
          <GaugeChart
            stationId={stationId}
            liveReading={liveReading}
            theme={theme}
            mode="history"
            days={30}
            title="Water Level — 30 Days"
            height={200}
          />
        )}

        {tab === 'info' && (
          <dl className="space-y-2 text-xs">
            {[
              ['Code', station.code],
              ['River', station.river],
              ['State', station.state],
              ['Coordinates', `${Number(station.lat).toFixed(4)}, ${Number(station.lon).toFixed(4)}`],
              ['Bankfull', station.bank_full_m != null ? `${station.bank_full_m} m` : '—'],
              ['Status', online ? 'Online (< 15 min)' : 'No recent reading'],
              [
                'Last reading',
                liveReading?.time
                  ? format(new Date(liveReading.time), 'dd MMM yyyy HH:mm')
                  : '—',
              ],
            ].map(([k, v]) => (
              <div
                key={k}
                className={clsx(
                  'flex items-center justify-between gap-3 rounded-lg border px-3 py-2',
                  dark ? 'border-gray-800 bg-gray-900/40' : 'border-slate-200 bg-slate-50',
                )}
              >
                <dt className={dark ? 'text-gray-500' : 'text-slate-500'}>{k}</dt>
                <dd className={clsx('font-medium tabular-nums', dark ? 'text-gray-100' : 'text-slate-800')}>
                  {v || '—'}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  )
}
