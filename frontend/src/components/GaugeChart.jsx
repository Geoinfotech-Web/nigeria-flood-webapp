import React, { useEffect, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import axios from 'axios'
import { format } from 'date-fns'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export default function GaugeChart({
  stationId,
  liveReading = null,
  theme = 'dark',
  mode = 'readings', // 'readings' | 'history'
  days = 7,
  hours = 24,
  title = null,
  height = 160,
}) {
  const [data, setData] = useState([])
  const isHistory = mode === 'history'

  useEffect(() => {
    if (!stationId) return undefined

    const load = () => {
      const url = isHistory
        ? `${API}/stations/${stationId}/history?days=${days}`
        : `${API}/stations/${stationId}/readings?hours=${hours}`
      return axios
        .get(url)
        .then((r) => setData(Array.isArray(r.data) ? r.data : []))
        .catch(console.error)
    }

    load()
    const id = setInterval(load, isHistory ? 300_000 : 60_000)
    return () => clearInterval(id)
  }, [stationId, isHistory, days, hours])

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

  const option = {
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'axis',
      formatter: (params) =>
        `${params[0].axisValueLabel}<br/>Level: ${params[0].value[1]}m`,
    },
    grid: { top: 24, bottom: 32, left: 48, right: 12 },
    xAxis: {
      type: 'time',
      axisLabel: {
        color: '#9ca3af',
        fontSize: 10,
        formatter: (v) =>
          format(new Date(v), isHistory && days > 7 ? 'dd MMM' : isHistory ? 'dd MMM' : 'HH:mm'),
      },
      axisLine: { lineStyle: { color: theme === 'dark' ? '#374151' : '#cbd5e1' } },
    },
    yAxis: {
      type: 'value',
      name: 'm',
      nameTextStyle: { color: '#9ca3af', fontSize: 10 },
      axisLabel: { color: '#9ca3af', fontSize: 10 },
      splitLine: { lineStyle: { color: theme === 'dark' ? '#1f2937' : '#e2e8f0' } },
    },
    series: [
      {
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
      },
    ],
  }

  return (
    <div>
      {heading?.trim() ? (
        <h3
          className={
            theme === 'dark'
              ? 'mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400'
              : 'mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500'
          }
        >
          {heading}
        </h3>
      ) : null}
      <ReactECharts option={option} style={{ height }} />
    </div>
  )
}
