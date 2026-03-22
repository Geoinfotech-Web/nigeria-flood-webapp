import React, { useEffect, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import axios from 'axios'
import { format } from 'date-fns'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export default function GaugeChart({ stationId }) {
  const [data, setData] = useState([])

  useEffect(() => {
    if (!stationId) return
    axios.get(`${API}/stations/${stationId}/readings?hours=24`)
      .then(r => setData(r.data))
      .catch(console.error)
  }, [stationId])

  const option = {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis', formatter: params =>
      `${params[0].axisValueLabel}<br/>Level: ${params[0].value[1]}m`
    },
    grid: { top: 24, bottom: 32, left: 48, right: 12 },
    xAxis: {
      type: 'time',
      axisLabel: { color: '#9ca3af', fontSize: 10,
        formatter: v => format(new Date(v), 'HH:mm') },
      axisLine: { lineStyle: { color: '#374151' } },
    },
    yAxis: {
      type: 'value', name: 'm',
      nameTextStyle: { color: '#9ca3af', fontSize: 10 },
      axisLabel: { color: '#9ca3af', fontSize: 10 },
      splitLine: { lineStyle: { color: '#1f2937' } },
    },
    series: [{
      type: 'line', smooth: true,
      data: data.map(d => [d.time, d.water_level_m]),
      lineStyle: { color: '#3b82f6', width: 2 },
      areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
        colorStops: [{ offset: 0, color: '#3b82f640' }, { offset: 1, color: '#3b82f600' }] } },
      symbol: 'none',
    }],
  }

  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
        Water Level — 24h
      </h3>
      <ReactECharts option={option} style={{ height: 160 }} />
    </div>
  )
}
