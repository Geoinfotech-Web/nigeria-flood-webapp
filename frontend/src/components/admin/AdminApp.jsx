import React, { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import axios from 'axios'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const TOKEN_KEY = 'gfw_admin_token'
const ROLE_KEY = 'gfw_admin_role'
const USER_KEY = 'gfw_admin_user'

function formatNgn(amount) {
  if (!amount) return '₦0'
  return `₦${Number(amount).toLocaleString('en-NG')}`
}

function useAdminApi(token) {
  return useMemo(() => {
    const client = axios.create({
      baseURL: `${API.replace(/\/$/, '')}`,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    return client
  }, [token])
}

function StatusPill({ value, theme }) {
  const dark = theme === 'dark'
  const tone =
    value === 'active'
      ? dark
        ? 'bg-teal-950 text-teal-200 border-teal-800'
        : 'bg-teal-50 text-teal-800 border-teal-200'
      : value === 'pending_payment' || value === 'pending'
        ? dark
          ? 'bg-amber-950 text-amber-200 border-amber-800'
          : 'bg-amber-50 text-amber-900 border-amber-200'
        : dark
          ? 'bg-red-950 text-red-200 border-red-800'
          : 'bg-red-50 text-red-800 border-red-200'
  return (
    <span className={clsx('rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase', tone)}>
      {value || '—'}
    </span>
  )
}

export default function AdminApp({ theme = 'light', onExit }) {
  const dark = theme === 'dark'
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || '')
  const [role, setRole] = useState(() => sessionStorage.getItem(ROLE_KEY) || '')
  const [username, setUsername] = useState(() => sessionStorage.getItem(USER_KEY) || '')
  const [tab, setTab] = useState('subscribers')
  const [loginUser, setLoginUser] = useState('')
  const [loginPass, setLoginPass] = useState('')
  const [loginError, setLoginError] = useState(null)
  const [loggingIn, setLoggingIn] = useState(false)

  const [subscribers, setSubscribers] = useState([])
  const [loadingList, setLoadingList] = useState(false)
  const [listError, setListError] = useState(null)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')

  const [wizard, setWizard] = useState({
    email: '',
    org_name: 'Geoinfotech',
    plan: 'internal',
    env: 'live',
    notes: 'In-house Flood Watch project',
  })
  const [wizardBusy, setWizardBusy] = useState(false)
  const [wizardError, setWizardError] = useState(null)
  const [issuedKey, setIssuedKey] = useState(null)
  const [copied, setCopied] = useState(false)

  const [billing, setBilling] = useState(null)
  const [billingForm, setBillingForm] = useState({
    public_subscribe_enabled: false,
    paystack_enabled: false,
    paystack_test_mode: true,
    notes: '',
  })
  const [billingBusy, setBillingBusy] = useState(false)
  const [billingMsg, setBillingMsg] = useState(null)
  const [testMsg, setTestMsg] = useState(null)

  const api = useAdminApi(token)
  const isSuper = role === 'super_admin'
  const canManage = role === 'admin' || role === 'super_admin'

  const logout = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(ROLE_KEY)
    sessionStorage.removeItem(USER_KEY)
    setToken('')
    setRole('')
    setUsername('')
  }, [])

  const login = async (e) => {
    e.preventDefault()
    setLoggingIn(true)
    setLoginError(null)
    try {
      const body = new URLSearchParams()
      body.set('username', loginUser.trim())
      body.set('password', loginPass)
      const { data } = await axios.post(`${API.replace(/\/$/, '')}/auth/token`, body, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      })
      sessionStorage.setItem(TOKEN_KEY, data.access_token)
      sessionStorage.setItem(ROLE_KEY, data.role)
      sessionStorage.setItem(USER_KEY, data.username)
      setToken(data.access_token)
      setRole(data.role)
      setUsername(data.username)
    } catch (err) {
      setLoginError(err?.response?.data?.detail || err.message || 'Login failed')
    } finally {
      setLoggingIn(false)
    }
  }

  const loadSubscribers = useCallback(async () => {
    if (!token) return
    setLoadingList(true)
    setListError(null)
    try {
      const params = { limit: 200 }
      if (query.trim()) params.q = query.trim()
      if (typeFilter !== 'all') params.subscriber_type = typeFilter
      const { data } = await api.get('/admin/subscribers', { params })
      setSubscribers(data.subscribers || [])
    } catch (err) {
      if (err?.response?.status === 401) logout()
      setListError(err?.response?.data?.detail || err.message || 'Failed to load')
    } finally {
      setLoadingList(false)
    }
  }, [api, logout, query, token, typeFilter])

  const loadBilling = useCallback(async () => {
    if (!token) return
    try {
      const { data } = await api.get('/admin/settings/billing')
      setBilling(data)
      setBillingForm({
        public_subscribe_enabled: Boolean(data.public_subscribe_enabled),
        paystack_enabled: Boolean(data.paystack_enabled),
        paystack_test_mode: Boolean(data.paystack_test_mode),
        notes: data.notes || '',
      })
    } catch (err) {
      if (err?.response?.status === 401) logout()
    }
  }, [api, logout, token])

  useEffect(() => {
    if (!token) return
    loadSubscribers()
    loadBilling()
  }, [token, loadSubscribers, loadBilling])

  const createInternal = async (e) => {
    e.preventDefault()
    if (!canManage) return
    setWizardBusy(true)
    setWizardError(null)
    setIssuedKey(null)
    try {
      const { data } = await api.post('/admin/subscribers/internal', {
        ...wizard,
        mint_key: true,
      })
      setIssuedKey(data.api_key || null)
      await loadSubscribers()
    } catch (err) {
      setWizardError(err?.response?.data?.detail || err.message || 'Create failed')
    } finally {
      setWizardBusy(false)
    }
  }

  const mintKey = async (id) => {
    if (!canManage) return
    try {
      const { data } = await api.post(`/admin/subscribers/${id}/keys`, {
        plan: 'pro',
        env: 'live',
        revoke_existing: true,
      })
      setIssuedKey(data.api_key || null)
      await loadSubscribers()
    } catch (err) {
      setListError(err?.response?.data?.detail || err.message)
    }
  }

  const suspend = async (id) => {
    if (!canManage) return
    if (!window.confirm('Suspend this subscriber and revoke active keys?')) return
    try {
      await api.post(`/admin/subscribers/${id}/suspend`)
      await loadSubscribers()
    } catch (err) {
      setListError(err?.response?.data?.detail || err.message)
    }
  }

  const activatePaid = async (id) => {
    if (!canManage) return
    try {
      const { data } = await api.post(`/admin/subscribers/${id}/activate-paid`)
      setIssuedKey(data.api_key || null)
      await loadSubscribers()
    } catch (err) {
      setListError(err?.response?.data?.detail || err.message)
    }
  }

  const saveBilling = async (e) => {
    e.preventDefault()
    if (!isSuper) return
    setBillingBusy(true)
    setBillingMsg(null)
    try {
      const { data } = await api.put('/admin/settings/billing', billingForm)
      setBillingMsg(data.message || 'Saved')
      await loadBilling()
    } catch (err) {
      setBillingMsg(err?.response?.data?.detail || err.message)
    } finally {
      setBillingBusy(false)
    }
  }

  const testPaystack = async () => {
    if (!isSuper) return
    setTestMsg(null)
    try {
      const { data } = await api.post('/admin/billing/test-connection')
      setTestMsg(data.message || 'OK')
    } catch (err) {
      setTestMsg(err?.response?.data?.detail || err.message)
    }
  }

  const copyKey = async () => {
    if (!issuedKey) return
    try {
      await navigator.clipboard.writeText(issuedKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  const shell = clsx(
    'flex min-h-0 flex-1 flex-col overflow-hidden',
    dark ? 'bg-slate-950 text-slate-100' : 'bg-slate-100 text-slate-900',
  )
  const card = clsx(
    'rounded-2xl border p-4 sm:p-5',
    dark ? 'border-slate-800 bg-slate-900/80' : 'border-slate-200 bg-white',
  )
  const input = clsx(
    'mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2',
    dark
      ? 'border-slate-700 bg-slate-950 text-slate-100 focus:ring-sky-800'
      : 'border-slate-200 bg-white text-slate-900 focus:ring-sky-200',
  )

  if (!token) {
    return (
      <div className={shell}>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
          <p className={clsx('text-[11px] font-semibold uppercase tracking-[0.18em]', dark ? 'text-sky-400' : 'text-sky-700')}>
            Flood Watch · Staff
          </p>
          <h1 className="font-display mt-2 text-3xl font-semibold">Admin console</h1>
          <p className={clsx('mt-2 text-sm', dark ? 'text-slate-400' : 'text-slate-600')}>
            Hidden staff area for API keys, subscribers, and billing configuration.
          </p>
          <form onSubmit={login} className={clsx(card, 'mt-6')}>
            <label className="block text-xs font-medium">
              Username
              <input
                className={input}
                value={loginUser}
                onChange={(e) => setLoginUser(e.target.value)}
                autoComplete="username"
                required
              />
            </label>
            <label className="mt-3 block text-xs font-medium">
              Password
              <input
                type="password"
                className={input}
                value={loginPass}
                onChange={(e) => setLoginPass(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            {loginError ? <p className="mt-3 text-sm text-red-500">{loginError}</p> : null}
            <button
              type="submit"
              disabled={loggingIn}
              className="mt-4 w-full rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-60"
            >
              {loggingIn ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          {onExit ? (
            <button
              type="button"
              onClick={onExit}
              className={clsx('mt-4 text-xs font-semibold underline-offset-2 hover:underline', dark ? 'text-slate-400' : 'text-slate-500')}
            >
              Back to Flood Watch
            </button>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className={shell}>
      <header
        className={clsx(
          'flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-3',
          dark ? 'border-slate-800 bg-slate-950/90' : 'border-slate-200 bg-white/90',
        )}
      >
        <div>
          <p className={clsx('text-[10px] font-semibold uppercase tracking-widest', dark ? 'text-sky-400' : 'text-sky-700')}>
            Admin console
          </p>
          <p className="text-sm font-semibold">
            {username} · <span className="font-mono text-xs opacity-80">{role}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[
            { id: 'subscribers', label: 'Subscribers' },
            { id: 'internal', label: 'In-house key' },
            { id: 'billing', label: 'Billing' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={clsx(
                'rounded-lg px-3 py-1.5 text-xs font-semibold transition',
                tab === t.id
                  ? 'bg-sky-700 text-white'
                  : dark
                    ? 'bg-slate-900 text-slate-300 hover:bg-slate-800'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
              )}
            >
              {t.label}
            </button>
          ))}
          <button
            type="button"
            onClick={logout}
            className={clsx(
              'rounded-lg border px-3 py-1.5 text-xs font-semibold',
              dark ? 'border-slate-700 text-slate-300' : 'border-slate-200 text-slate-600',
            )}
          >
            Sign out
          </button>
          {onExit ? (
            <button
              type="button"
              onClick={onExit}
              className={clsx(
                'rounded-lg border px-3 py-1.5 text-xs font-semibold',
                dark ? 'border-slate-700 text-slate-300' : 'border-slate-200 text-slate-600',
              )}
            >
              Exit
            </button>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto w-full max-w-5xl space-y-5">
          {issuedKey ? (
            <div
              className={clsx(
                'rounded-xl border p-4',
                dark ? 'border-amber-800/50 bg-amber-950/40' : 'border-amber-200 bg-amber-50',
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-200">
                  Copy this API key now — it will not be shown again
                </p>
                <button
                  type="button"
                  onClick={copyKey}
                  className={clsx(
                    'rounded-md border px-2.5 py-1 text-[11px] font-semibold',
                    dark ? 'border-amber-700 text-amber-100' : 'border-amber-300 text-amber-900',
                  )}
                >
                  {copied ? 'Copied' : 'Copy key'}
                </button>
              </div>
              <code className={clsx('mt-2 block break-all font-mono text-xs', dark ? 'text-amber-100' : 'text-amber-950')}>
                {issuedKey}
              </code>
              <button
                type="button"
                onClick={() => setIssuedKey(null)}
                className={clsx('mt-3 text-[11px] font-semibold underline-offset-2 hover:underline', dark ? 'text-amber-200/80' : 'text-amber-800')}
              >
                Dismiss
              </button>
            </div>
          ) : null}

          {tab === 'subscribers' && (
            <section className={card}>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="font-display text-xl font-semibold">Subscribers</h2>
                  <p className={clsx('mt-1 text-xs', dark ? 'text-slate-400' : 'text-slate-500')}>
                    External self-serve accounts and in-house project keys.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <input
                    className={clsx(input, 'mt-0 w-44')}
                    placeholder="Search email / org"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <select
                    className={clsx(input, 'mt-0 w-36')}
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                  >
                    <option value="all">All types</option>
                    <option value="internal">Internal</option>
                    <option value="external">External</option>
                  </select>
                  <button
                    type="button"
                    onClick={loadSubscribers}
                    className="rounded-lg bg-sky-700 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-600"
                  >
                    Refresh
                  </button>
                </div>
              </div>
              {listError ? <p className="mt-3 text-sm text-red-500">{listError}</p> : null}
              {loadingList ? (
                <p className={clsx('mt-4 text-sm', dark ? 'text-slate-400' : 'text-slate-500')}>Loading…</p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-left text-xs">
                    <thead className={clsx(dark ? 'text-slate-400' : 'text-slate-500')}>
                      <tr>
                        <th className="px-2 py-2 font-semibold">Org / email</th>
                        <th className="px-2 py-2 font-semibold">Type</th>
                        <th className="px-2 py-2 font-semibold">Status</th>
                        <th className="px-2 py-2 font-semibold">Plan</th>
                        <th className="px-2 py-2 font-semibold">Key</th>
                        <th className="px-2 py-2 font-semibold">Today</th>
                        <th className="px-2 py-2 font-semibold">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {subscribers.map((s) => (
                        <tr key={s.id} className={clsx('border-t', dark ? 'border-slate-800' : 'border-slate-100')}>
                          <td className="px-2 py-2">
                            <div className="font-medium">{s.org_name}</div>
                            <div className={clsx('font-mono', dark ? 'text-slate-400' : 'text-slate-500')}>{s.email}</div>
                          </td>
                          <td className="px-2 py-2">{s.subscriber_type}</td>
                          <td className="px-2 py-2">
                            <StatusPill value={s.status} theme={theme} />
                          </td>
                          <td className="px-2 py-2">{s.active_plan || s.preferred_plan}</td>
                          <td className="px-2 py-2 font-mono">{s.active_key_prefix || '—'}</td>
                          <td className="px-2 py-2 tabular-nums">{s.usage_today}</td>
                          <td className="px-2 py-2">
                            {canManage ? (
                              <div className="flex flex-wrap gap-1">
                                <button
                                  type="button"
                                  onClick={() => mintKey(s.id)}
                                  className={clsx(
                                    'rounded border px-2 py-0.5 text-[10px] font-semibold',
                                    dark ? 'border-slate-700' : 'border-slate-200',
                                  )}
                                >
                                  Mint key
                                </button>
                                {s.status === 'pending_payment' || s.billing_status === 'pending' ? (
                                  <button
                                    type="button"
                                    onClick={() => activatePaid(s.id)}
                                    className={clsx(
                                      'rounded border px-2 py-0.5 text-[10px] font-semibold',
                                      dark ? 'border-teal-800 text-teal-200' : 'border-teal-200 text-teal-800',
                                    )}
                                  >
                                    Activate paid
                                  </button>
                                ) : null}
                                {s.status !== 'suspended' ? (
                                  <button
                                    type="button"
                                    onClick={() => suspend(s.id)}
                                    className={clsx(
                                      'rounded border px-2 py-0.5 text-[10px] font-semibold',
                                      dark ? 'border-red-900 text-red-300' : 'border-red-200 text-red-700',
                                    )}
                                  >
                                    Suspend
                                  </button>
                                ) : null}
                              </div>
                            ) : (
                              <span className={dark ? 'text-slate-500' : 'text-slate-400'}>View only</span>
                            )}
                          </td>
                        </tr>
                      ))}
                      {!subscribers.length ? (
                        <tr>
                          <td colSpan={7} className={clsx('px-2 py-8 text-center', dark ? 'text-slate-500' : 'text-slate-400')}>
                            No subscribers yet
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {tab === 'internal' && (
            <section className={card}>
              <h2 className="font-display text-xl font-semibold">Create in-house API key</h2>
              <p className={clsx('mt-1 text-xs', dark ? 'text-slate-400' : 'text-slate-500')}>
                For Geoinfotech / Flood Watch projects — no public subscribe flow required.
              </p>
              {!canManage ? (
                <p className="mt-4 text-sm text-amber-600">Viewer role cannot mint keys.</p>
              ) : (
                <form onSubmit={createInternal} className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="block text-xs font-medium">
                    Project / org name
                    <input
                      className={input}
                      required
                      value={wizard.org_name}
                      onChange={(e) => setWizard((w) => ({ ...w, org_name: e.target.value }))}
                    />
                  </label>
                  <label className="block text-xs font-medium">
                    Contact email
                    <input
                      type="email"
                      className={input}
                      required
                      value={wizard.email}
                      onChange={(e) => setWizard((w) => ({ ...w, email: e.target.value }))}
                    />
                  </label>
                  <label className="block text-xs font-medium">
                    Plan
                    <select
                      className={input}
                      value={wizard.plan}
                      onChange={(e) => setWizard((w) => ({ ...w, plan: e.target.value }))}
                    >
                      <option value="internal">Internal (high limits)</option>
                      <option value="pro">Pro</option>
                      <option value="starter">Starter</option>
                      <option value="free">Free</option>
                    </select>
                  </label>
                  <label className="block text-xs font-medium">
                    Environment
                    <select
                      className={input}
                      value={wizard.env}
                      onChange={(e) => setWizard((w) => ({ ...w, env: e.target.value }))}
                    >
                      <option value="live">live</option>
                      <option value="test">test</option>
                    </select>
                  </label>
                  <label className="block text-xs font-medium sm:col-span-2">
                    Notes
                    <input
                      className={input}
                      value={wizard.notes}
                      onChange={(e) => setWizard((w) => ({ ...w, notes: e.target.value }))}
                    />
                  </label>
                  {wizardError ? <p className="text-sm text-red-500 sm:col-span-2">{wizardError}</p> : null}
                  <button
                    type="submit"
                    disabled={wizardBusy}
                    className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-60 sm:col-span-2 sm:w-fit"
                  >
                    {wizardBusy ? 'Creating…' : 'Create subscriber + mint key'}
                  </button>
                </form>
              )}
            </section>
          )}

          {tab === 'billing' && (
            <section className={card}>
              <h2 className="font-display text-xl font-semibold">Billing & Paystack</h2>
              <p className={clsx('mt-1 text-xs', dark ? 'text-slate-400' : 'text-slate-500')}>
                Public self-serve API stays greyed out until billing is ready. Secrets stay in Secret Manager / env.
              </p>

              {billing ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  {[
                    ['Secret key', billing.secrets?.secret_key_configured],
                    ['Public key', billing.secrets?.public_key_configured],
                    ['Webhook secret', billing.secrets?.webhook_secret_configured],
                  ].map(([label, ok]) => (
                    <div
                      key={label}
                      className={clsx(
                        'rounded-xl border px-3 py-3 text-xs',
                        dark ? 'border-slate-800 bg-slate-950/50' : 'border-slate-100 bg-slate-50',
                      )}
                    >
                      <p className={dark ? 'text-slate-400' : 'text-slate-500'}>{label}</p>
                      <p className="mt-1 font-semibold">{ok ? 'Configured' : 'Not configured'}</p>
                    </div>
                  ))}
                </div>
              ) : null}

              {billing?.webhook_url ? (
                <p className={clsx('mt-3 break-all font-mono text-[11px]', dark ? 'text-slate-400' : 'text-slate-500')}>
                  Webhook URL: {billing.webhook_url}
                </p>
              ) : null}

              {isSuper ? (
                <form onSubmit={saveBilling} className="mt-5 space-y-3">
                  {[
                    ['public_subscribe_enabled', 'Public self-serve subscribe enabled'],
                    ['paystack_enabled', 'Paystack enabled'],
                    ['paystack_test_mode', 'Paystack test mode'],
                  ].map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={Boolean(billingForm[key])}
                        onChange={(e) => setBillingForm((f) => ({ ...f, [key]: e.target.checked }))}
                      />
                      {label}
                    </label>
                  ))}
                  <label className="block text-xs font-medium">
                    Notes
                    <textarea
                      className={input}
                      rows={3}
                      value={billingForm.notes}
                      onChange={(e) => setBillingForm((f) => ({ ...f, notes: e.target.value }))}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="submit"
                      disabled={billingBusy}
                      className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-60"
                    >
                      {billingBusy ? 'Saving…' : 'Save settings'}
                    </button>
                    <button
                      type="button"
                      onClick={testPaystack}
                      className={clsx(
                        'rounded-lg border px-4 py-2 text-sm font-semibold',
                        dark ? 'border-slate-700 text-slate-200' : 'border-slate-200 text-slate-700',
                      )}
                    >
                      Test Paystack connection
                    </button>
                  </div>
                  {billingMsg ? <p className="text-sm">{billingMsg}</p> : null}
                  {testMsg ? <p className="text-sm">{typeof testMsg === 'string' ? testMsg : JSON.stringify(testMsg)}</p> : null}
                </form>
              ) : (
                <p className={clsx('mt-4 text-sm', dark ? 'text-slate-400' : 'text-slate-500')}>
                  Super-admin role required to edit billing settings.
                  {billing ? (
                    <>
                      {' '}
                      Public subscribe: <strong>{billing.public_subscribe_enabled ? 'on' : 'off'}</strong>
                      {' · '}
                      Paystack: <strong>{billing.paystack_enabled ? 'enabled' : 'disabled'}</strong>
                    </>
                  ) : null}
                </p>
              )}

              {billing?.plans?.length ? (
                <div className="mt-6">
                  <h3 className="text-sm font-semibold">Plan catalog</h3>
                  <ul className="mt-2 grid gap-2 sm:grid-cols-3">
                    {billing.plans.map((p) => (
                      <li
                        key={p.id}
                        className={clsx(
                          'rounded-xl border px-3 py-3 text-xs',
                          dark ? 'border-slate-800' : 'border-slate-100',
                        )}
                      >
                        <div className="flex justify-between gap-2">
                          <span className="font-semibold">{p.name}</span>
                          <span>{p.price_ngn_monthly ? `${formatNgn(p.price_ngn_monthly)}/mo` : 'Free'}</span>
                        </div>
                        <p className={clsx('mt-1', dark ? 'text-slate-400' : 'text-slate-500')}>
                          {p.rate_limit_per_min}/min · {(p.daily_quota || 0).toLocaleString()}/day
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
