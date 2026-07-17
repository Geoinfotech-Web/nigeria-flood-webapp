import React, { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import { IconAlertTriangle, IconCheck, IconX } from './Icons'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const TYPES = ['Flash flood', 'River overflow', 'Urban flooding', 'Coastal flooding', 'Road inundation', 'Other']
const SEVERITIES = ['Low', 'Moderate', 'High', 'Critical']
const EMPTY_FORM = { location_name: '', affected_street: '', flood_source: '', incident_type: 'Flash flood', severity: 'Moderate', description: '', water_depth_cm: '', latitude: null, longitude: null }
const TOKEN_KEY = 'flood_report_edit_tokens'
const severityColor = { Low: 'bg-emerald-500', Moderate: 'bg-amber-400', High: 'bg-orange-500', Critical: 'bg-red-500' }

function loadTokens() {
  try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || '{}') } catch { return {} }
}
function saveTokens(tokens) { localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens)) }
function timeAgo(value) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`
  return `${Math.floor(minutes / 1440)}d ago`
}

export default function FloodIncidentReporter({
  theme,
  open: controlledOpen,
  onOpenChange,
  showTrigger = true,
  initialTab = null,
}) {
  const dark = theme === 'dark'
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen
  const [tab, setTab] = useState(initialTab || 'report')
  const [form, setForm] = useState(EMPTY_FORM)
  const [media, setMedia] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [reports, setReports] = useState([])
  const [tokens, setTokens] = useState(loadTokens)
  const [locating, setLocating] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    if (open && initialTab) setTab(initialTab)
  }, [open, initialTab])

  const loadReports = useCallback(async () => {
    try {
      const response = await fetch(`${API}/incidents?limit=20`)
      if (response.ok) setReports(await response.json())
    } catch (_) { /* Keep the form usable if the feed is offline. */ }
  }, [])

  useEffect(() => {
    loadReports()
    const timer = setInterval(loadReports, 20000)
    return () => clearInterval(timer)
  }, [loadReports])

  const update = (key, value) => setForm(current => ({ ...current, [key]: value }))
  const resetForm = () => { setForm(EMPTY_FORM); setMedia(null); setEditingId(null) }

  const useLocation = () => {
    setNotice(null)
    if (!navigator.geolocation) return setNotice({ type: 'error', text: 'Location is not supported by this browser.' })
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const latitude = coords.latitude
        const longitude = coords.longitude
        let locationName = `Near ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
        try {
          const response = await fetch(`${API}/geocode/reverse?lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`)
          if (response.ok) {
            const place = await response.json()
            locationName = place.street_address || place.display_name || place.name || locationName
          }
        } catch (_) { /* Coordinates remain a usable fallback if geocoding is offline. */ }
        setForm(current => ({ ...current, location_name: locationName.slice(0, 160), latitude, longitude }))
        setLocating(false)
        setNotice({ type: 'success', text: `Location identified (±${Math.round(coords.accuracy)} m)` })
      },
      () => { setLocating(false); setNotice({ type: 'error', text: 'Location permission was denied. Type the location instead.' }) },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    )
  }

  const uploadMedia = async (reportId, token) => {
    if (!media) return
    const body = new FormData()
    body.append('media', media)
    const response = await fetch(`${API}/incidents/${reportId}/media`, { method: 'POST', headers: { 'X-Edit-Token': token }, body })
    if (!response.ok) throw new Error((await response.json()).detail || 'The media upload failed.')
  }

  const submit = async event => {
    event.preventDefault()
    setSubmitting(true); setNotice(null)
    try {
      const payload = { ...form, location_name: form.location_name.trim(), description: form.description.trim(), water_depth_cm: form.water_depth_cm === '' ? null : Number(form.water_depth_cm) }
      const token = editingId ? tokens[editingId] : null
      const response = await fetch(editingId ? `${API}/incidents/${editingId}` : `${API}/incidents`, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Edit-Token': token } : {}) },
        body: JSON.stringify(payload),
      })
      if (!response.ok) throw new Error((await response.json()).detail || 'The report could not be saved.')
      const saved = await response.json()
      const editToken = editingId ? token : saved.edit_token
      if (!editingId) {
        const next = { ...tokens, [saved.id]: editToken }
        setTokens(next); saveTokens(next)
      }
      await uploadMedia(saved.id, editToken)
      resetForm()
      setNotice({ type: 'success', text: editingId ? 'Report updated.' : 'Report submitted. Keep using this browser to edit or delete it.' })
      await loadReports()
      setTimeout(() => setTab('feed'), 600)
    } catch (error) {
      setNotice({ type: 'error', text: typeof error.message === 'string' ? error.message : 'Unable to save this report.' })
    } finally { setSubmitting(false) }
  }

  const startEdit = report => {
    setForm({ location_name: report.location_name, affected_street: report.affected_street || '', flood_source: report.flood_source || '', incident_type: report.incident_type, severity: report.severity, description: report.description, water_depth_cm: report.water_depth_cm ?? '', latitude: report.latitude, longitude: report.longitude })
    setMedia(null); setEditingId(report.id); setNotice(null); setTab('report')
  }

  const removeReport = async report => {
    if (!window.confirm(`Delete your flood report for ${report.location_name}?`)) return
    try {
      const response = await fetch(`${API}/incidents/${report.id}`, { method: 'DELETE', headers: { 'X-Edit-Token': tokens[report.id] } })
      if (!response.ok) throw new Error('The report could not be deleted.')
      const next = { ...tokens }; delete next[report.id]; setTokens(next); saveTokens(next)
      await loadReports()
    } catch (error) { setNotice({ type: 'error', text: error.message }) }
  }

  return (
    <div className="absolute bottom-3 left-3 z-30">
      {open && <section className={clsx('mb-2 flex max-h-[min(42rem,calc(100vh-8rem))] w-[min(24rem,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border shadow-2xl backdrop-blur-xl', dark ? 'border-gray-700/90 bg-gray-950/95 text-gray-100' : 'border-slate-200 bg-white/95 text-slate-900')}>
        <header className={clsx('flex items-start justify-between border-b px-4 py-3', dark ? 'border-gray-800' : 'border-slate-200')}>
          <div><div className="flex items-center gap-2"><span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /><h2 className="text-sm font-semibold">Live flood reports</h2></div><p className={clsx('mt-1 text-[10px]', dark ? 'text-gray-400' : 'text-slate-500')}>Add a photo or video; manage reports submitted on this browser</p></div>
          <button type="button" onClick={() => setOpen(false)} className={clsx('rounded-lg p-1.5', dark ? 'hover:bg-gray-800' : 'hover:bg-slate-100')} aria-label="Close flood reports"><IconX size={14} /></button>
        </header>
        <div className={clsx('grid grid-cols-2 border-b p-1.5', dark ? 'border-gray-800' : 'border-slate-200')}>
          {['report', 'feed'].map(item => <button key={item} type="button" onClick={() => { setTab(item); if (item === 'report' && editingId) resetForm() }} className={clsx('rounded-lg px-3 py-2 text-xs font-semibold transition', tab === item ? 'bg-blue-600 text-white' : dark ? 'text-gray-400 hover:bg-gray-800' : 'text-slate-500 hover:bg-slate-100')}>{item === 'report' ? (editingId ? 'Edit report' : 'Report incident') : `Reports (${reports.length})`}</button>)}
        </div>

        {tab === 'report' ? <form onSubmit={submit} className="space-y-3 overflow-y-auto p-4">
          <div><label className="mb-1 block text-[11px] font-semibold">Location *</label><div className="flex gap-2"><input required minLength={2} maxLength={160} value={form.location_name} onChange={e => update('location_name', e.target.value)} placeholder="Street, community, LGA or state" className={inputClass(dark, 'flex-1 min-w-0')} /><button type="button" onClick={useLocation} disabled={locating} className={clsx('shrink-0 rounded-lg border px-2.5 text-[10px] font-semibold', dark ? 'border-blue-500/40 bg-blue-500/10 text-blue-300' : 'border-blue-200 bg-blue-50 text-blue-700')}>{locating ? 'Locating…' : form.latitude ? 'Located' : 'Use GPS'}</button></div></div>
          <label className="block text-[11px] font-semibold">Affected street (optional)<input maxLength={160} value={form.affected_street} onChange={e => update('affected_street', e.target.value)} placeholder="e.g. Airport Road near Market Junction" className={inputClass(dark, 'mt-1 w-full')} /></label>
          <label className="block text-[11px] font-semibold">Source of flood (optional)<input maxLength={160} value={form.flood_source} onChange={e => update('flood_source', e.target.value)} placeholder="e.g. overflowing river, blocked drain, heavy rain" className={inputClass(dark, 'mt-1 w-full')} /></label>
          <div className="grid grid-cols-2 gap-2"><label className="text-[11px] font-semibold">Flood type<select value={form.incident_type} onChange={e => update('incident_type', e.target.value)} className={inputClass(dark, 'mt-1 w-full')}>{TYPES.map(type => <option key={type}>{type}</option>)}</select></label><label className="text-[11px] font-semibold">Severity<select value={form.severity} onChange={e => update('severity', e.target.value)} className={inputClass(dark, 'mt-1 w-full')}>{SEVERITIES.map(level => <option key={level}>{level}</option>)}</select></label></div>
          <label className="block text-[11px] font-semibold">Estimated water depth (cm)<input type="number" min="0" max="1000" value={form.water_depth_cm} onChange={e => update('water_depth_cm', e.target.value)} placeholder="Optional" className={inputClass(dark, 'mt-1 w-full')} /></label>
          <label className="block text-[11px] font-semibold">What is happening? *<textarea required minLength={10} maxLength={1000} rows={3} value={form.description} onChange={e => update('description', e.target.value)} placeholder="Describe affected roads, homes, water movement and people at risk…" className={inputClass(dark, 'mt-1 w-full resize-none')} /></label>
          <div className="space-y-2"><label className="block text-[11px] font-semibold">Photo or video (optional)<input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" onChange={e => setMedia(e.target.files?.[0] || null)} className={clsx('mt-1 block w-full rounded-lg border p-2 text-[10px]', dark ? 'border-gray-700 bg-gray-900' : 'border-slate-200 bg-white')} /></label>{media && <p className="truncate text-[9px] text-emerald-500">Attached: {media.name}</p>}<span className={clsx('block text-[9px]', dark ? 'text-gray-500' : 'text-slate-400')}>JPG, PNG, WebP, MP4, WebM or MOV; maximum 25 MB.</span></div>
          {notice && <Notice notice={notice} />}
          <div className="flex gap-2">{editingId && <button type="button" onClick={resetForm} className={clsx('rounded-xl border px-3 py-2.5 text-xs', dark ? 'border-gray-700' : 'border-slate-300')}>Cancel</button>}<button disabled={submitting} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-red-500 disabled:opacity-60"><IconAlertTriangle size={13} />{submitting ? 'Saving…' : editingId ? 'Update report' : 'Submit flood report'}</button></div>
        </form> : <div className="space-y-2 overflow-y-auto p-3">
          {notice && <Notice notice={notice} />}
          {!reports.length && <p className={clsx('py-10 text-center text-xs', dark ? 'text-gray-500' : 'text-slate-400')}>No community reports yet.</p>}
          {reports.map(report => <article key={report.id} className={clsx('overflow-hidden rounded-xl border', dark ? 'border-gray-800 bg-gray-900/80' : 'border-slate-200 bg-slate-50')}>
            {report.media_url && (report.media_type === 'video' ? <video controls preload="metadata" className="max-h-48 w-full bg-black" src={`${API}${report.media_url}`} /> : <img className="max-h-48 w-full object-cover" src={`${API}${report.media_url}`} alt={`Flood report from ${report.location_name}`} />)}
            <div className="p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="flex items-center gap-1.5"><span className={clsx('h-2 w-2 shrink-0 rounded-full', severityColor[report.severity])} /><h3 className="truncate text-xs font-semibold">{report.location_name}</h3></div><p className={clsx('mt-1 text-[10px]', dark ? 'text-gray-400' : 'text-slate-500')}>{report.incident_type} · {report.severity}</p></div><span className={clsx('shrink-0 text-[9px]', dark ? 'text-gray-500' : 'text-slate-400')}>{timeAgo(report.updated_at || report.created_at)}</span></div>{report.affected_street && <p className="mt-2 text-[10px] font-semibold text-blue-500">Affected street: {report.affected_street}</p>}{report.flood_source && <p className={clsx('mt-1 text-[10px]', dark ? 'text-gray-400' : 'text-slate-500')}>Source: {report.flood_source}</p>}<p className={clsx('mt-2 text-[10px] leading-relaxed', dark ? 'text-gray-300' : 'text-slate-600')}>{report.description}</p>
            <div className="mt-2 flex items-center justify-between"><span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[8px] font-semibold uppercase text-amber-500">Unverified</span>{tokens[report.id] && <span className="flex gap-1"><button type="button" onClick={() => startEdit(report)} className="rounded-md bg-blue-600 px-2 py-1 text-[9px] font-semibold text-white">Edit</button><button type="button" onClick={() => removeReport(report)} className="rounded-md bg-red-600 px-2 py-1 text-[9px] font-semibold text-white">Delete</button></span>}</div></div>
          </article>)}
        </div>}
      </section>}
      {showTrigger && <button type="button" onClick={() => setOpen(value => !value)} className="flex items-center gap-2 rounded-xl bg-red-600 px-3.5 py-2.5 text-xs font-semibold text-white"><IconAlertTriangle size={15} /> Report flood</button>}
    </div>
  )
}

function inputClass(dark, extra = '') { return clsx('rounded-lg border px-2.5 py-2 text-xs outline-none focus:border-blue-500', dark ? 'border-gray-700 bg-gray-900 text-gray-100 placeholder:text-gray-600' : 'border-slate-200 bg-white text-slate-900 placeholder:text-slate-400', extra) }
function Notice({ notice }) { const success = notice.type === 'success'; return <div className={clsx('flex items-start gap-2 rounded-lg border px-3 py-2 text-[10px]', success ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500' : 'border-red-500/30 bg-red-500/10 text-red-400')}>{success ? <IconCheck size={12} /> : <IconAlertTriangle size={12} />}<span>{notice.text}</span></div> }
