import React, { useEffect, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import axios from 'axios'
import { format } from 'date-fns'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export default function RainfallChart({ stationId, stationName, theme = 'dark' }) {
  const [data, setData] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!stationId) return undefined

    const load = () => {
      setLoaded(false)
      setError(null)
      return axios
        .get(`${API}/stations/${stationId}/rainfall?days=7`)
        .then((r) => setData(Array.isArray(r.data) ? r.data : []))
        .catch((err) => {
          console.error(err)
          setData([])
          setError('Could not load rainfall')
        })
        .finally(() => setLoaded(true))
    }

    load()
    const id = setInterval(load, 300_000)
    return () => clearInterval(id)
  }, [stationId])

  const byDate = {}
  for (const r of data) {
    const raw = r?.date
    if (!raw) continue
    const d = String(raw).slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue
    byDate[d] = (byDate[d] || 0) + (Number(r.total_rain_mm) || 0)
  }
  const dates = Object.keys(byDate).sort()
  const empty = loaded && !error && dates.length === 0

  const option = {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis' },
    grid: { top: 24, bottom: 32, left: 48, right: 12 },
    xAxis: {
      type: 'category',
      data: dates,
      axisLabel: {
        color: '#9ca3af',
        fontSize: 10,
        formatter: (v) => {
          try {
            return format(new Date(`${v}T00:00:00`), 'dd MMM')
          } catch {
            return v
          }
        },
      },
      axisLine: { lineStyle: { color: theme === 'dark' ? '#374151' : '#cbd5e1' } },
    },
    yAxis: {
      type: 'value',
      name: 'mm',
      nameTextStyle: { color: '#9ca3af', fontSize: 10 },
      axisLabel: { color: '#9ca3af', fontSize: 10 },
      splitLine: { lineStyle: { color: theme === 'dark' ? '#1f2937' : '#e2e8f0' } },
    },
    series: [{
      type: 'bar',
      data: dates.map((d) => Number(byDate[d].toFixed(1))),
      itemStyle: { color: '#6366f1', borderRadius: [3, 3, 0, 0] },
    }],
  }

  const headingClass =
    theme === 'dark'
      ? 'mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400'
      : 'mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500'
  const emptyClass =
    theme === 'dark' ? 'text-[11px] text-gray-500' : 'text-[11px] text-slate-500'

  return (
    <div>
      <h3 className={headingClass}>
        {stationName ? `${stationName} Rainfall - 7 Days` : 'Rainfall - 7 Days'}
      </h3>
      {!loaded && <p className={emptyClass}>Loading rainfall…</p>}
      {loaded && error && <p className={emptyClass}>{error}</p>}
      {empty && <p className={emptyClass}>No rainfall observations for this catchment yet.</p>}
      {loaded && !error && dates.length > 0 && (
        <ReactECharts option={option} style={{ height: 140 }} />
      )}
    </div>
  )
}
