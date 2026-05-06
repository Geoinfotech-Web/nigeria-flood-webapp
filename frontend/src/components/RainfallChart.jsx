import React, { useEffect, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import axios from 'axios'
import { format } from 'date-fns'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export default function RainfallChart({ theme = 'dark' }) {
  const [data, setData] = useState([])

  useEffect(() => {
    axios.get(`${API}/rainfall/daily?days=7`)
      .then(r => setData(r.data))
      .catch(console.error)
  }, [])

  const byDate = {}
  for (const r of data) {
    const d = r.date.slice(0, 10)
    byDate[d] = (byDate[d] || 0) + (r.total_rain_mm || 0)
  }
  const dates = Object.keys(byDate).sort()

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
        formatter: v => format(new Date(v), 'dd MMM'),
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
      data: dates.map(d => byDate[d].toFixed(1)),
      itemStyle: { color: '#6366f1', borderRadius: [3, 3, 0, 0] },
    }],
  }

  return (
    <div>
      <h3 className={theme === 'dark'
        ? 'mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400'
        : 'mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500'}>
        Rainfall â€” 7 days
      </h3>
      <ReactECharts option={option} style={{ height: 140 }} />
    </div>
  )
}
