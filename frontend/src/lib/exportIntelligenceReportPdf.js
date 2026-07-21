/** Build a printable HTML document and trigger Save-as-PDF via the browser print dialog. */
export function exportIntelligenceReportPdf({
  place,
  overallRisk,
  primaryStation,
  terrain,
  site,
  suitability,
  actions = [],
  horizons = {},
  roads = [],
  settlements = [],
  gauges = [],
}) {
  const esc = (v) =>
    String(v ?? '—')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')

  const when = new Date().toLocaleString()
  const horizonRows = ['6h', '12h', '24h', '48h', '72h']
    .map((k) => {
      const h = horizons[k]
      const prob = h?.flood_prob
      const pct = prob == null ? '—' : `${Math.round(prob <= 1 ? prob * 100 : prob)}%`
      return `<tr><td>${k}</td><td>${pct}</td><td>${esc(h?.risk_tier || '—')}</td></tr>`
    })
    .join('')

  const reasonList = (suitability?.reasons || []).map((r) => `<li>${esc(r)}</li>`).join('')
  const useList = (suitability?.uses || []).map((r) => `<li>${esc(r)}</li>`).join('')
  const actionList = actions.map((r) => `<li>${esc(r)}</li>`).join('')
  const roadList = roads
    .slice(0, 12)
    .map(
      (r) =>
        `<li>${esc(r.name || r.ref || 'Unnamed road')} — ${esc(r.class || '')} · ${esc(r.susceptibility || '—')} · ${esc(r.distance_km)} km</li>`,
    )
    .join('')
  const placeList = settlements
    .slice(0, 8)
    .map(
      (s) =>
        `<li>${esc(s.name)} (${esc(s.class || '')}) — ${esc(s.susceptibility || '—')} · ${esc(s.risk_tier || '—')}</li>`,
    )
    .join('')
  const gaugeList = gauges
    .slice(0, 5)
    .map(
      (g) =>
        `<li>${esc(g.name)} — ${esc(g.overall_risk)} · ${esc(Number(g.distance_km).toFixed?.(1) ?? g.distance_km)} km</li>`,
    )
    .join('')

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>GGIS Flood Watch — ${esc(place?.name || 'Location')} Intelligence Report</title>
  <style>
    body { font-family: Georgia, "Times New Roman", serif; color: #0f172a; margin: 32px; line-height: 1.45; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.06em; margin: 22px 0 8px; color: #334155; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; }
    .meta { color: #64748b; font-size: 12px; margin-bottom: 16px; }
    .badge { display: inline-block; padding: 2px 8px; border: 1px solid #94a3b8; border-radius: 999px; font-size: 11px; font-weight: 700; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; font-size: 13px; }
    ul { margin: 6px 0 0 18px; padding: 0; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; }
    th { background: #f1f5f9; }
    .foot { margin-top: 24px; font-size: 11px; color: #64748b; }
    @media print { body { margin: 16px; } }
  </style>
</head>
<body>
  <h1>GGIS Flood Watch — Location Intelligence</h1>
  <div class="meta">Generated ${esc(when)} · Advisory screening only — confirm with NIHSA / local authorities</div>
  <p><strong>${esc(place?.name || 'Selected location')}</strong><br/>
  ${esc(place?.display_name || '')}<br/>
  ${esc(Number(place?.lat).toFixed(5))}, ${esc(Number(place?.lon).toFixed(5))}
  &nbsp; <span class="badge">${esc(overallRisk || 'Normal')}</span></p>

  <h2>This location — site suitability</h2>
  <p><strong>${esc(suitability?.verdict || 'Assessment unavailable')}</strong>
  ${suitability?.susceptibility ? ` · Susceptibility: ${esc(suitability.susceptibility)}` : ''}</p>
  <ul>${reasonList || '<li>No detailed reasons available.</li>'}</ul>

  <h2>Practical uses</h2>
  <ul>${useList || '<li>Use as a screening aid for housing, land, and access decisions.</li>'}</ul>

  <h2>Key facts</h2>
  <div class="grid">
    <div>Elevation: <strong>${esc(terrain?.elevation_m != null ? `${terrain.elevation_m} m` : '—')}</strong></div>
    <div>Slope: <strong>${esc(terrain?.slope_deg != null ? `${terrain.slope_deg}° (${terrain.slope_class || ''})` : '—')}</strong></div>
    <div>Primary gauge: <strong>${esc(primaryStation?.name || '—')}</strong></div>
    <div>Gauge distance: <strong>${esc(primaryStation?.distance_km != null ? `${Number(primaryStation.distance_km).toFixed(1)} km` : '—')}</strong></div>
    <div>Zones inside: <strong>${esc((site?.zones_inside || []).length)}</strong></div>
    <div>Zones nearby: <strong>${esc((site?.zones_nearby || []).length)}</strong></div>
  </div>

  <h2>Operator advisory</h2>
  <ul>${actionList || '<li>Monitor conditions and confirm with official guidance.</li>'}</ul>

  <h2>72-hour gauge outlook</h2>
  <table>
    <thead><tr><th>Horizon</th><th>Flood prob.</th><th>Tier</th></tr></thead>
    <tbody>${horizonRows}</tbody>
  </table>

  <h2>Roads at risk</h2>
  <ul>${roadList || '<li>None listed.</li>'}</ul>

  <h2>Nearby places</h2>
  <ul>${placeList || '<li>None listed.</li>'}</ul>

  <h2>Monitoring stations</h2>
  <ul>${gaugeList || '<li>None listed.</li>'}</ul>

  <p class="foot">GGIS Flood Watch location intelligence combines nearest-gauge forecasts, flood susceptibility, terrain (SRTM), and mapped hazard zones. Not a substitute for formal flood risk surveys or legal due diligence.</p>
  <script>window.onload = function () { window.print(); };</script>
</body>
</html>`

  const win = window.open('', '_blank', 'noopener,noreferrer,width=900,height=700')
  if (!win) {
    // Popup blocked — fall back to blob download of HTML the user can print
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `GGIS-Flood-Watch-${(place?.name || 'location').replace(/[^\w\-]+/g, '_')}-report.html`
    a.click()
    URL.revokeObjectURL(url)
    return
  }
  win.document.open()
  win.document.write(html)
  win.document.close()
}
