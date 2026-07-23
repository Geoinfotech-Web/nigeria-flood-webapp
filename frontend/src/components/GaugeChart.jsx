import React, { useEffect, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import axios from 'axios'
import { format } from 'date-fns'
import clsx from 'clsx'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

/** Same bankfull fractions as stationRisk / StationList. */
const WATCH_FRAC = 0.7
const WARNING_FRAC = 0.85

let stationsBankCache = null
let stationsBankPromise = null

async function lookupBankFull(stationId) {
  if (!stationId) return null
  if (!stationsBankPromise) {
    stationsBankPromise = axios
      .get(`${API}/stations`)
      .then((r) => {
        const rows = Array.isArray(r.data) ? r.data : []
        stationsBankCache = new Map(
          rows.map((s) => [s.id, s.bank_full_m != null ? Number(s.bank_full_m) : null]),
        )
        return stationsBankCache
      })
      .catch(() => {
        stationsBankPromise = null
        return null
      })
  }
  const cache = await stationsBankPromise
  if (!cache) return null
  return cache.get(stationId) ?? null
}

function buildYScale(levels, thresholds) {
  const dataMin = levels.length ? Math.min(...levels) : 0
  const dataMax = levels.length ? Math.max(...levels) : 0
  const span = Math.max(dataMax - dataMin, Math.abs(dataMax) * 0.12, 0.25)

  let yMin = Math.max(0, dataMin - span * 0.2)
  let yMax = dataMax + span * 0.35

  // Only pull the axis up for thresholds that are near the observed range
  // (avoids a flat line when bankfull is far above current levels).
  const nearCap = Math.max(dataMax * 1.85, yMax * 1.35, dataMax + span * 2)
  for (const t of thresholds) {
    if (t.y != null && t.y <= nearCap) {
      yMax = Math.max(yMax, t.y + span * 0.1)
    }
  }

  if (yMax <= yMin) yMax = yMin + 0.5
  return {
    yMin: Number(yMin.toFixed(2)),
    yMax: Number(yMax.toFixed(2)),
  }
}

export default function GaugeChart({
  stationId,
  liveReading = null,
  bankFullM = null,
  theme = 'dark',
  mode = 'readings', // 'readings' | 'history'
  days = 7,
  hours = 24,
  title = null,
  height = 160,
}) {
  const [data, setData] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [fetchedBankFull, setFetchedBankFull] = useState(null)
  const isHistory = mode === 'history'
  const dark = theme === 'dark'

  useEffect(() => {
    if (!stationId) return undefined

    const load = () => {
      setLoaded(false)
      const url = isHistory
        ? `${API}/stations/${stationId}/history?days=${days}`
        : `${API}/stations/${stationId}/readings?hours=${hours}`
      return axios
        .get(url)
        .then((r) => setData(Array.isArray(r.data) ? r.data : []))
        .catch(() => setData([]))
        .finally(() => setLoaded(true))
    }

    load()
    const id = setInterval(load, isHistory ? 300_000 : 60_000)
    return () => clearInterval(id)
  }, [stationId, isHistory, days, hours])

  useEffect(() => {
    if (bankFullM != null || liveReading?.bank_full_m != null) {
      setFetchedBankFull(null)
      return undefined
    }
    let cancelled = false
    lookupBankFull(stationId).then((v) => {
      if (!cancelled) setFetchedBankFull(v)
    })
    return () => {
      cancelled = true
    }
  }, [stationId, bankFullM, liveReading?.bank_full_m])

  const bankFull = useMemo(() => {
    const raw = bankFullM ?? liveReading?.bank_full_m ?? fetchedBankFull
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  }, [bankFullM, liveReading?.bank_full_m, fetchedBankFull])

  const seriesData = isHistory
    ? data.map((d) => [d.time, d.avg_level_m ?? d.max_level_m])
    : (() => {
        const rows = [...data]
        if (liveReading?.time) {
          const lastPoint = rows[rows.length - 1]
          if (!lastPoint) {
            rows.push({ time: liveReading.time, water_level_m: liveReading.water_level_m })
          } else {
            const lastTime = new Date(lastPoint.time).getTime()
            const liveTime = new Date(liveReading.time).getTime()
            if (liveTime > lastTime) {
              rows.push({ time: liveReading.time, water_level_m: liveReading.water_level_m })
            } else if (liveTime === lastTime) {
              rows[rows.length - 1] = {
                ...lastPoint,
                water_level_m: liveReading.water_level_m,
              }
            }
          }
        }
        return rows.map((d) => [d.time, d.water_level_m])
      })()

  const heading =
    title ||
    (isHistory ? `Water Level — ${days} Days` : `Water Level - ${hours}h`)

  const emptyMessage = isHistory
    ? 'No hourly history available yet for this station.'
    : 'No recent gauge readings available for this window.'

  const thresholds = useMemo(() => {
    if (bankFull == null) return []
    return [
      { key: 'watch', name: 'Watch', y: bankFull * WATCH_FRAC, color: '#eab308' },
      { key: 'warning', name: 'Warning', y: bankFull * WARNING_FRAC, color: '#f97316' },
      { key: 'bankfull', name: 'Bankfull', y: bankFull, color: '#ef4444' },
    ]
  }, [bankFull])

  const levels = seriesData
    .map((row) => Number(row?.[1]))
    .filter((v) => Number.isFinite(v))
  const { yMin, yMax } = buildYScale(levels, thresholds)

  const visibleThresholds = thresholds.filter((t) => t.y >= yMin && t.y <= yMax)
  const hiddenThresholds = thresholds.filter((t) => t.y > yMax)

  const markLine =
    visibleThresholds.length > 0
      ? {
          symbol: 'none',
          silent: true,
          animation: false,
          label: { show: false },
          data: visibleThresholds.map((t) => ({
            yAxis: t.y,
            name: t.name,
            lineStyle: { color: t.color, type: 'dashed', width: 1.4, opacity: 0.9 },
          })),
        }
      : undefined

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      formatter: (params) => {
        const p = params?.[0]
        if (!p) return ''
        const level = Array.isArray(p.value) ? p.value[1] : p.value
        let extra = ''
        if (bankFull != null && Number.isFinite(Number(level))) {
          const pct = Math.round((Number(level) / bankFull) * 100)
          extra = `<br/>Bankfull: ${pct}%`
        }
        return `${p.axisValueLabel}<br/>Level: ${level} m${extra}`
      },
    },
    grid: { top: 12, bottom: 28, left: 44, right: 10 },
    xAxis: {
      type: 'time',
      axisLabel: {
        color: '#9ca3af',
        fontSize: 10,
        hideOverlap: true,
        formatter: (v) =>
          format(new Date(v), isHistory && days > 7 ? 'dd MMM' : isHistory ? 'dd MMM' : 'HH:mm'),
      },
      axisLine: { lineStyle: { color: dark ? '#374151' : '#cbd5e1' } },
    },
    yAxis: {
      type: 'value',
      name: 'm',
      min: yMin,
      max: yMax,
      scale: false,
      nameTextStyle: { color: '#9ca3af', fontSize: 10 },
      axisLabel: { color: '#9ca3af', fontSize: 10, hideOverlap: true },
      splitLine: { lineStyle: { color: dark ? '#1f2937' : '#e2e8f0' } },
    },
    series: [
      {
        name: 'Water level',
        type: 'line',
        smooth: true,
        data: seriesData,
        lineStyle: { color: '#3b82f6', width: 2 },
        areaStyle: {
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: '#3b82f640' },
              { offset: 1, color: '#3b82f600' },
            ],
          },
        },
        symbol: 'none',
        markLine,
      },
    ],
  }

  return (
    <div>
      {heading?.trim() ? (
        <h3
          className={clsx(
            'mb-1.5 text-xs font-semibold uppercase tracking-wider',
            dark ? 'text-gray-400' : 'text-slate-500',
          )}
        >
          {heading}
        </h3>
      ) : null}
      {loaded && seriesData.length === 0 ? (
        <div
          className={clsx(
            'flex items-center justify-center rounded-lg border text-center text-xs',
            dark
              ? 'border-gray-800 bg-gray-900/40 text-gray-500'
              : 'border-slate-200 bg-slate-50 text-slate-500',
          )}
          style={{ height }}
        >
          {emptyMessage}
        </div>
      ) : (
        <>
          <ReactECharts option={option} style={{ height }} notMerge />
          {thresholds.length > 0 && (
            <div
              className={clsx(
                'mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px]',
                dark ? 'text-gray-400' : 'text-slate-500',
              )}
            >
              {thresholds.map((t) => {
                const inView = visibleThresholds.some((v) => v.key === t.key)
                return (
                  <span key={t.key} className="inline-flex items-center gap-1.5">
                    <span
                      className="inline-block h-0.5 w-3 rounded-full"
                      style={{
                        backgroundColor: t.color,
                        opacity: inView ? 1 : 0.45,
                      }}
                    />
                    <span style={{ color: t.color }} className="font-semibold">
                      {t.name}
                    </span>
                    <span className="tabular-nums">{t.y.toFixed(2)} m</span>
                    {!inView && <span className="opacity-70">(above)</span>}
                  </span>
                )
              })}
            </div>
          )}
          {hiddenThresholds.length > 0 && levels.length > 0 && (
            <p className={clsx('mt-0.5 text-[10px]', dark ? 'text-gray-500' : 'text-slate-400')}>
              Axis scaled to recent levels so the series stays readable.
            </p>
          )}
        </>
      )}
    </div>
  )
}
