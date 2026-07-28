/** Shared Flood Hotspot heatmap ramp — keep legend + map in sync. */

/** Opaque stops used by the legend gradient (low → high intensity). */
export const FLOOD_HOTSPOT_LEGEND_STOPS = [
  { label: 'Lower', color: '#60a5fa' },
  { label: '', color: '#93c5fd' },
  { label: '', color: '#fef08a' },
  { label: '', color: '#fdba74' },
  { label: '', color: '#f87171' },
  { label: 'Higher', color: '#dc2626' },
]

/** MapLibre `heatmap-color` expression stops (density → rgba). */
export const FLOOD_HOTSPOT_HEATMAP_COLOR = [
  'interpolate',
  ['linear'],
  ['heatmap-density'],
  0,
  'rgba(59,130,246,0)',
  0.04,
  'rgba(96,165,250,0.28)',
  0.12,
  'rgba(125,211,252,0.48)',
  0.24,
  'rgba(147,197,253,0.68)',
  0.4,
  'rgba(254,240,138,0.84)',
  0.58,
  'rgba(253,186,116,0.92)',
  0.76,
  'rgba(248,113,113,0.96)',
  1,
  'rgba(220,38,38,0.99)',
]

export function floodHotspotHeatmapPaint() {
  return {
    'heatmap-weight': [
      'interpolate',
      ['linear'],
      ['coalesce', ['get', 'heat_weight'], 0],
      1, 0.2,
      3, 0.4,
      6, 0.65,
      10, 0.85,
      16, 1,
    ],
    'heatmap-intensity': [
      'interpolate',
      ['linear'],
      ['zoom'],
      4, 0.7,
      8, 0.9,
      11, 1.05,
      14, 1.15,
      17, 1.25,
    ],
    'heatmap-color': FLOOD_HOTSPOT_HEATMAP_COLOR,
    'heatmap-radius': [
      'interpolate',
      ['exponential', 1.75],
      ['zoom'],
      4, 28,
      6, 40,
      8, 64,
      10, 110,
      12, 200,
      14, 360,
      16, 560,
      18, 820,
    ],
    'heatmap-opacity': [
      'interpolate',
      ['linear'],
      ['zoom'],
      4, 0.74,
      10, 0.84,
      14, 0.78,
      18, 0.72,
    ],
  }
}

export function floodHotspotLegendGradient() {
  return `linear-gradient(90deg, ${FLOOD_HOTSPOT_LEGEND_STOPS.map((s) => s.color).join(', ')})`
}
