/** Build a print-ready HTML report and open the browser Save-as-PDF dialog. */

import { HORIZON_KEYS, normalizeHorizons } from './horizons'

const TIER_STYLE = {
  Normal: { bg: '#f0fdfa', border: '#99f6e4', text: '#0f766e' },
  Watch: { bg: '#fffbeb', border: '#fcd34d', text: '#b45309' },
  Warning: { bg: '#fff7ed', border: '#fdba74', text: '#c2410c' },
  Emergency: { bg: '#fef2f2', border: '#fca5a5', text: '#b91c1c' },
}

function esc(v) {
  return String(v ?? '—')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fmtKm(km) {
  if (km == null || Number.isNaN(Number(km))) return '—'
  const n = Number(km)
  if (n < 1) return `${Math.round(n * 1000)} m`
  if (n < 10) return `${n.toFixed(1)} km`
  return `${Math.round(n)} km`
}

function fmtCoord(n) {
  return Number.isFinite(Number(n)) ? Number(n).toFixed(5) : '—'
}

function fmtProb(prob) {
  if (prob == null || !Number.isFinite(Number(prob))) return '—'
  const pct = Number(prob) <= 1 ? Number(prob) * 100 : Number(prob)
  return `${Math.round(pct)}%`
}

function badgeHtml(label, tier = 'Normal') {
  const s = TIER_STYLE[tier] || TIER_STYLE.Normal
  return `<span class="badge" style="background:${s.bg};border-color:${s.border};color:${s.text}">${esc(label)}</span>`
}

function listOrEmpty(itemsHtml, empty = 'None listed.') {
  return itemsHtml || `<li class="muted">${esc(empty)}</li>`
}

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
  const when = new Date().toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  const tier = overallRisk || 'Normal'
  const verdictTier = suitability?.verdictTier || 'Normal'
  const placeTitle = place?.name || 'Selected location'
  const display = place?.display_name || [place?.class, place?.state].filter(Boolean).join(' · ') || ''

  const normalizedHorizons = normalizeHorizons(horizons)
  const horizonRows = HORIZON_KEYS
    .map((k) => {
      const h = normalizedHorizons[k] || {}
      const hTier = h.risk_tier || 'Normal'
      return `<tr>
        <td><strong>${k}</strong></td>
        <td class="num">${fmtProb(h.flood_prob)}</td>
        <td>${badgeHtml(hTier, hTier)}</td>
      </tr>`
    })
    .join('')

  const reasonList = (suitability?.reasons || [])
    .map((r) => `<li>${esc(r)}</li>`)
    .join('')
  const useList = (suitability?.uses || [])
    .map((r) => `<li>${esc(r)}</li>`)
    .join('')
  const actionList = actions.map((r) => `<li>${esc(r)}</li>`).join('')

  const roadRows = roads
    .slice(0, 12)
    .map((r) => {
      const name = r.name || r.ref || `Unnamed ${r.class || 'road'}`
      return `<tr>
        <td>${esc(name)}</td>
        <td>${esc(r.class || '—')}${r.bridge ? ' · bridge' : ''}</td>
        <td>${esc(r.susceptibility || '—')}</td>
        <td class="num">${esc(fmtKm(r.distance_km))}</td>
      </tr>`
    })
    .join('')

  const placeRows = settlements
    .slice(0, 8)
    .map(
      (s) => `<tr>
        <td>${esc(s.name)}</td>
        <td>${esc(s.class || '—')}</td>
        <td>${esc(s.susceptibility || '—')}</td>
        <td>${badgeHtml(s.risk_tier || '—', s.risk_tier || 'Normal')}</td>
        <td class="num">${esc(fmtKm(s.distance_km))}</td>
      </tr>`,
    )
    .join('')

  const gaugeRows = gauges
    .slice(0, 5)
    .map(
      (g) => `<tr>
        <td>${esc(g.name)}</td>
        <td>${esc(g.river || '—')}</td>
        <td>${badgeHtml(g.overall_risk || 'Normal', g.overall_risk || 'Normal')}</td>
        <td class="num">${esc(fmtKm(g.distance_km))}</td>
      </tr>`,
    )
    .join('')

  const zoneInside = (site?.zones_inside || [])
    .slice(0, 4)
    .map(
      (z) =>
        `<li><strong>${esc(z.risk_tier)}</strong> — ${esc(z.name)} (${esc(
          z.source === 'urban_flash_flood' ? 'urban flash' : 'inundation',
        )})</li>`,
    )
    .join('')
  const zoneNear = (site?.zones_nearby || [])
    .slice(0, 4)
    .map(
      (z) =>
        `<li><strong>${esc(z.risk_tier)}</strong> — ${esc(z.name)} · ${esc(fmtKm(z.distance_km))}</li>`,
    )
    .join('')

  const elev =
    terrain?.elevation_m != null ? `${terrain.elevation_m} m` : '—'
  const slope =
    terrain?.slope_deg != null
      ? `${terrain.slope_deg}°${terrain.slope_class ? ` · ${terrain.slope_class}` : ''}`
      : '—'
  const gaugeDist =
    primaryStation?.distance_km != null ? fmtKm(primaryStation.distance_km) : '—'

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>GGIS Flood Watch — ${esc(placeTitle)} Intelligence Report</title>
  <style>
    @page {
      size: A4;
      margin: 14mm 14mm 16mm 14mm;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #0f172a;
      background: #fff;
      font-family: "Segoe UI", "Source Sans 3", Helvetica, Arial, sans-serif;
      font-size: 11.5px;
      line-height: 1.45;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page {
      max-width: 780px;
      margin: 0 auto;
      padding: 18px 20px 28px;
    }
    .toolbar {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-bottom: 12px;
    }
    .toolbar button {
      border: 1px solid #cbd5e1;
      background: #0ea5e9;
      color: #fff;
      font-weight: 600;
      font-size: 12px;
      border-radius: 8px;
      padding: 8px 14px;
      cursor: pointer;
    }
    .toolbar button.secondary {
      background: #fff;
      color: #0f172a;
    }
    .header {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-start;
      border-bottom: 2px solid #0ea5e9;
      padding-bottom: 12px;
      margin-bottom: 14px;
    }
    .brand-kicker {
      margin: 0;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #0284c7;
    }
    .brand-title {
      margin: 2px 0 0;
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.02em;
      color: #0f172a;
    }
    .doc-meta {
      text-align: right;
      font-size: 10.5px;
      color: #64748b;
      line-height: 1.5;
      min-width: 160px;
    }
    .place-block {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-start;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 12px 14px;
      margin-bottom: 14px;
    }
    .place-block h2 {
      margin: 0;
      font-size: 16px;
      font-weight: 700;
    }
    .place-block .sub {
      margin: 4px 0 0;
      color: #64748b;
      font-size: 11px;
    }
    .coords {
      margin-top: 4px;
      font-family: ui-monospace, Consolas, monospace;
      font-size: 10.5px;
      color: #475569;
    }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border: 1px solid;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 700;
      white-space: nowrap;
      vertical-align: middle;
    }
    .section {
      margin: 0 0 14px;
      page-break-inside: avoid;
    }
    .section h3 {
      margin: 0 0 8px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #334155;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 4px;
    }
    .verdict {
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 12px 14px;
      background: #fff;
    }
    .verdict-title {
      margin: 6px 0 8px;
      font-size: 13px;
      font-weight: 700;
      color: #0f172a;
    }
    .metrics {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      margin-bottom: 14px;
    }
    .metric {
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 8px 10px;
      background: #f8fafc;
    }
    .metric .label {
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #64748b;
    }
    .metric .value {
      margin-top: 2px;
      font-size: 13px;
      font-weight: 700;
      color: #0f172a;
    }
    .metric .hint {
      margin-top: 1px;
      font-size: 10px;
      color: #64748b;
    }
    ul {
      margin: 0;
      padding-left: 18px;
    }
    li { margin: 3px 0; }
    .muted { color: #64748b; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 10.5px;
    }
    th, td {
      border: 1px solid #e2e8f0;
      padding: 6px 8px;
      text-align: left;
      vertical-align: top;
    }
    th {
      background: #f1f5f9;
      font-size: 9.5px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #475569;
    }
    td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .two-col {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .foot {
      margin-top: 18px;
      padding-top: 10px;
      border-top: 1px solid #e2e8f0;
      font-size: 9.5px;
      color: #64748b;
      line-height: 1.5;
    }
    .foot strong { color: #475569; }
    @media print {
      .toolbar { display: none !important; }
      .page { padding: 0; max-width: none; }
      a { color: inherit; text-decoration: none; }
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="toolbar">
      <button type="button" class="secondary" onclick="window.close()">Close</button>
      <button type="button" onclick="window.print()">Save as PDF</button>
    </div>

    <header class="header">
      <div>
        <p class="brand-kicker">GGIS Flood Watch</p>
        <h1 class="brand-title">Location Intelligence Report</h1>
      </div>
      <div class="doc-meta">
        <div><strong>Generated</strong><br/>${esc(when)}</div>
        <div style="margin-top:6px"><strong>Document</strong><br/>Site flood screening</div>
      </div>
    </header>

    <section class="place-block">
      <div>
        <h2>${esc(placeTitle)}</h2>
        ${display ? `<p class="sub">${esc(display)}</p>` : ''}
        <div class="coords">${esc(fmtCoord(place?.lat))}, ${esc(fmtCoord(place?.lon))}</div>
      </div>
      <div style="text-align:right">
        <div style="margin-bottom:6px">${badgeHtml(`Gauge outlook · ${tier}`, tier)}</div>
        <div>${badgeHtml(`Site · ${verdictTier}`, verdictTier)}</div>
      </div>
    </section>

    <section class="section">
      <h3>This location — site suitability</h3>
      <div class="verdict">
        <div>${badgeHtml(verdictTier, verdictTier)}
          ${suitability?.susceptibility ? ` ${badgeHtml(`Susceptibility · ${suitability.susceptibility}`, suitability.susceptibility === 'Highly Susceptible' || suitability.susceptibility === 'High' ? 'Warning' : suitability.susceptibility === 'Moderate' ? 'Watch' : 'Normal')}` : ''}
        </div>
        <p class="verdict-title">${esc(suitability?.verdict || 'Assessment unavailable')}</p>
        <ul>${listOrEmpty(reasonList, 'No detailed reasons available.')}</ul>
      </div>
    </section>

    <section class="section">
      <h3>Key facts</h3>
      <div class="metrics">
        <div class="metric">
          <div class="label">Elevation</div>
          <div class="value">${esc(elev)}</div>
          <div class="hint">SRTM</div>
        </div>
        <div class="metric">
          <div class="label">Slope</div>
          <div class="value">${esc(slope)}</div>
          <div class="hint">Approx. local gradient</div>
        </div>
        <div class="metric">
          <div class="label">Primary gauge</div>
          <div class="value">${esc(primaryStation?.name || '—')}</div>
          <div class="hint">${esc(gaugeDist)}</div>
        </div>
        <div class="metric">
          <div class="label">72h outlook</div>
          <div class="value">${esc(tier)}</div>
          <div class="hint">Nearest-gauge model</div>
        </div>
        <div class="metric">
          <div class="label">Zones inside</div>
          <div class="value">${esc((site?.zones_inside || []).length)}</div>
          <div class="hint">Mapped hazard polygons</div>
        </div>
        <div class="metric">
          <div class="label">Zones nearby</div>
          <div class="value">${esc((site?.zones_nearby || []).length)}</div>
          <div class="hint">Within assessment radius</div>
        </div>
      </div>
    </section>

    <section class="section two-col">
      <div>
        <h3>Practical uses</h3>
        <ul>${listOrEmpty(useList, 'Use as a screening aid for housing, land, and access decisions.')}</ul>
      </div>
      <div>
        <h3>Operator advisory</h3>
        <ul>${listOrEmpty(actionList, 'Monitor conditions and confirm with official guidance.')}</ul>
      </div>
    </section>

    ${(zoneInside || zoneNear) ? `
    <section class="section two-col">
      <div>
        <h3>Hazard zones at this point</h3>
        <ul>${listOrEmpty(zoneInside, 'No mapped zone intersects this point.')}</ul>
      </div>
      <div>
        <h3>Nearby hazard zones</h3>
        <ul>${listOrEmpty(zoneNear, 'No nearby mapped zones.')}</ul>
      </div>
    </section>` : ''}

    <section class="section">
      <h3>72-hour gauge outlook</h3>
      <table>
        <thead>
          <tr><th>Horizon</th><th>Flood probability</th><th>Risk tier</th></tr>
        </thead>
        <tbody>${horizonRows}</tbody>
      </table>
    </section>

    <section class="section">
      <h3>Roads at risk</h3>
      ${roadRows ? `<table>
        <thead>
          <tr><th>Road</th><th>Class</th><th>Susceptibility</th><th>Distance</th></tr>
        </thead>
        <tbody>${roadRows}</tbody>
      </table>` : `<p class="muted">No moderate+ susceptibility roads nearby.</p>`}
    </section>

    <section class="section">
      <h3>Nearby places</h3>
      ${placeRows ? `<table>
        <thead>
          <tr><th>Place</th><th>Class</th><th>Susceptibility</th><th>Risk</th><th>Distance</th></tr>
        </thead>
        <tbody>${placeRows}</tbody>
      </table>` : `<p class="muted">No nearby settlements listed.</p>`}
    </section>

    <section class="section">
      <h3>Monitoring stations</h3>
      ${gaugeRows ? `<table>
        <thead>
          <tr><th>Station</th><th>River</th><th>Outlook</th><th>Distance</th></tr>
        </thead>
        <tbody>${gaugeRows}</tbody>
      </table>` : `<p class="muted">No gauges within monitoring range.</p>`}
    </section>

    <footer class="foot">
      <strong>Disclaimer.</strong> GGIS Flood Watch location intelligence combines nearest-gauge forecasts,
      flood susceptibility, terrain (SRTM), and mapped hazard zones. This is an advisory screening product only —
      not a substitute for formal flood risk surveys, engineering assessment, NIHSA guidance, or legal due diligence.
    </footer>
  </div>
  <script>
    window.addEventListener('load', function () {
      setTimeout(function () { window.print(); }, 250);
    });
  </script>
</body>
</html>`

  const filenameBase = `GGIS-Flood-Watch-${String(placeTitle).replace(/[^\w\-]+/g, '_').slice(0, 48)}-report`

  const win = window.open('', '_blank', 'noopener,noreferrer,width=920,height=780')
  if (!win) {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${filenameBase}.html`
    a.click()
    URL.revokeObjectURL(url)
    return
  }
  win.document.open()
  win.document.write(html)
  win.document.close()
}
