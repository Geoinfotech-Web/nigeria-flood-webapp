import React, { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import axios from 'axios'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const FALLBACK_PLANS = [
  {
    id: 'free',
    name: 'Free',
    price_ngn_monthly: 0,
    rate_limit_per_min: 60,
    daily_quota: 10000,
    requires_payment: false,
    features: ['Gauges & outlook', 'Flood risk', 'Location intelligence'],
  },
  {
    id: 'starter',
    name: 'Starter',
    price_ngn_monthly: 25000,
    rate_limit_per_min: 300,
    daily_quota: 100000,
    requires_payment: true,
    features: ['Higher limits', 'Priority location intel', 'Email support'],
  },
  {
    id: 'pro',
    name: 'Pro',
    price_ngn_monthly: 75000,
    rate_limit_per_min: 1000,
    daily_quota: 500000,
    requires_payment: true,
    features: ['Highest quotas', 'Commercial use', 'Onboarding'],
  },
]

const FALLBACK_METHODS = [
  { id: 'card', label: 'Card' },
  { id: 'bank_transfer', label: 'Bank transfer' },
  { id: 'ussd', label: 'USSD' },
]

function formatNgn(amount) {
  if (!amount) return '₦0'
  return `₦${Number(amount).toLocaleString('en-NG')}`
}

export default function DevelopersPage({ theme = 'light', preview = false }) {
  const dark = theme === 'dark'
  const [email, setEmail] = useState('')
  const [orgName, setOrgName] = useState('')
  const [plan, setPlan] = useState('free')
  const [paymentMethod, setPaymentMethod] = useState('card')
  const [plans, setPlans] = useState(FALLBACK_PLANS)
  const [methods, setMethods] = useState(FALLBACK_METHODS)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [copied, setCopied] = useState(false)

  const baseUrl = useMemo(() => `${API.replace(/\/$/, '')}/v1`, [])
  const docsUrl = `${baseUrl}/docs`
  const selectedPlan = plans.find((p) => p.id === plan) || plans[0]
  const needsPayment = Boolean(selectedPlan?.requires_payment)

  useEffect(() => {
    let cancelled = false
    axios
      .get(`${API}/v1/plans`)
      .then(({ data }) => {
        if (cancelled) return
        if (Array.isArray(data?.plans) && data.plans.length) setPlans(data.plans)
        if (Array.isArray(data?.payment_methods) && data.payment_methods.length) {
          setMethods(data.payment_methods)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const curlSample = result?.api_key
    ? `curl -s "${baseUrl}/location/site-assessment?lat=6.5244&lon=3.3792" -H "X-API-Key: ${result.api_key}"`
    : `curl -s "${baseUrl}/location/site-assessment?lat=6.5244&lon=3.3792" -H "X-API-Key: gfw_live_YOUR_KEY"`

  const subscribe = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const payload = {
        email: email.trim(),
        org_name: orgName.trim(),
        env: 'live',
        plan,
      }
      if (needsPayment) payload.payment_method = paymentMethod
      const { data } = await axios.post(`${API}/v1/subscribe`, payload)
      setResult(data)
    } catch (err) {
      const detail = err?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : err.message || 'Subscribe failed')
    } finally {
      setLoading(false)
    }
  }

  const copyKey = async () => {
    if (!result?.api_key) return
    try {
      await navigator.clipboard.writeText(result.api_key)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div
      className={clsx(
        'min-h-0 flex-1 overflow-y-auto',
        dark
          ? 'bg-gradient-to-b from-slate-950 via-slate-950 to-sky-950/40'
          : 'bg-gradient-to-b from-sky-50 via-white to-cyan-50/60',
      )}
    >
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        {preview ? (
          <p
            className={clsx(
              'mb-3 rounded-lg border px-3 py-2 text-[11px] font-medium',
              dark
                ? 'border-amber-800/50 bg-amber-950/40 text-amber-200'
                : 'border-amber-200 bg-amber-50 text-amber-900',
            )}
          >
            Internal preview — public API tab is Coming soon. Share only for testing.
          </p>
        ) : null}

        <p
          className={clsx(
            'text-[11px] font-semibold uppercase tracking-[0.18em]',
            dark ? 'text-sky-400' : 'text-sky-700',
          )}
        >
          Developer API
        </p>
        <h2 className="font-display mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
          GGIS Flood Watch API
        </h2>
        <p className={clsx('mt-3 max-w-2xl text-sm leading-relaxed sm:text-base', dark ? 'text-slate-300' : 'text-slate-600')}>
          Gauges, outlooks, flood risk, and location intelligence (site assessment, terrain,
          nearby settlements & roads) for your apps. Free keys issue immediately; paid plans
          use card, bank transfer, or USSD.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {plans.map((p) => {
            const active = plan === p.id
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPlan(p.id)}
                className={clsx(
                  'rounded-xl border px-3 py-3 text-left transition',
                  active
                    ? dark
                      ? 'border-sky-500 bg-sky-950/50'
                      : 'border-sky-500 bg-sky-50'
                    : dark
                      ? 'border-slate-800 bg-slate-900/70 hover:border-slate-600'
                      : 'border-slate-200 bg-white/80 hover:border-slate-300',
                )}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold">{p.name}</span>
                  <span className={clsx('text-xs font-medium', dark ? 'text-sky-300' : 'text-sky-700')}>
                    {p.price_ngn_monthly ? `${formatNgn(p.price_ngn_monthly)}/mo` : 'Free'}
                  </span>
                </div>
                <p className={clsx('mt-1 text-[11px]', dark ? 'text-slate-400' : 'text-slate-500')}>
                  {p.rate_limit_per_min}/min · {(p.daily_quota || 0).toLocaleString()}/day
                </p>
              </button>
            )
          })}
        </div>

        <form
          onSubmit={subscribe}
          className={clsx(
            'mt-8 rounded-2xl border p-4 sm:p-6',
            dark ? 'border-slate-800 bg-slate-900/60' : 'border-slate-200 bg-white/90',
          )}
        >
          <h3 className="font-display text-lg font-semibold">
            {needsPayment ? `Subscribe · ${selectedPlan?.name}` : 'Get a free API key'}
          </h3>
          <p className={clsx('mt-1 text-xs', dark ? 'text-slate-400' : 'text-slate-500')}>
            {needsPayment
              ? 'Choose a payment mode. Key activates after payment confirmation.'
              : 'The full key is shown once. Store it securely.'}
          </p>

          {needsPayment ? (
            <div className="mt-4">
              <p className="text-xs font-medium">Payment mode</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {methods.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setPaymentMethod(m.id)}
                    className={clsx(
                      'rounded-lg border px-3 py-1.5 text-xs font-semibold transition',
                      paymentMethod === m.id
                        ? dark
                          ? 'border-sky-500 bg-sky-900/50 text-sky-200'
                          : 'border-sky-600 bg-sky-100 text-sky-900'
                        : dark
                          ? 'border-slate-700 text-slate-300'
                          : 'border-slate-200 text-slate-600',
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-medium">
              Work email
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={clsx(
                  'mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2',
                  dark
                    ? 'border-slate-700 bg-slate-950 text-slate-100 focus:ring-sky-700'
                    : 'border-slate-200 bg-white text-slate-900 focus:ring-sky-200',
                )}
                placeholder="you@organisation.org"
              />
            </label>
            <label className="block text-xs font-medium">
              Organisation
              <input
                type="text"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                className={clsx(
                  'mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2',
                  dark
                    ? 'border-slate-700 bg-slate-950 text-slate-100 focus:ring-sky-700'
                    : 'border-slate-200 bg-white text-slate-900 focus:ring-sky-200',
                )}
                placeholder="Optional"
              />
            </label>
          </div>
          {error ? <p className="mt-3 text-sm text-red-500">{error}</p> : null}
          <button
            type="submit"
            disabled={loading}
            className={clsx(
              'mt-4 inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold text-white transition',
              loading ? 'bg-sky-800/70' : 'bg-sky-700 hover:bg-sky-600',
            )}
          >
            {loading ? 'Working…' : needsPayment ? 'Continue to payment' : 'Subscribe'}
          </button>

          {result?.api_key ? (
            <div
              className={clsx(
                'mt-5 rounded-xl border p-3',
                dark ? 'border-amber-800/50 bg-amber-950/30' : 'border-amber-200 bg-amber-50',
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                  Copy your key now — it will not be shown again
                </p>
                <button
                  type="button"
                  onClick={copyKey}
                  className={clsx(
                    'rounded-md border px-2.5 py-1 text-[11px] font-semibold',
                    dark
                      ? 'border-amber-700 text-amber-200 hover:bg-amber-900/40'
                      : 'border-amber-300 text-amber-900 hover:bg-amber-100',
                  )}
                >
                  {copied ? 'Copied' : 'Copy key'}
                </button>
              </div>
              <code className={clsx('mt-2 block break-all text-xs', dark ? 'text-amber-100' : 'text-amber-950')}>
                {result.api_key}
              </code>
            </div>
          ) : null}

          {result && !result.api_key && result.billing_ref ? (
            <div
              className={clsx(
                'mt-5 rounded-xl border p-3 text-xs',
                dark ? 'border-sky-800/50 bg-sky-950/40 text-sky-100' : 'border-sky-200 bg-sky-50 text-sky-900',
              )}
            >
              <p className="font-semibold">Payment pending</p>
              <p className="mt-1">
                Ref <span className="font-mono">{result.billing_ref}</span>
                {result.payment_method ? ` · ${result.payment_method}` : ''}
                {result.checkout?.amount_ngn != null
                  ? ` · ${formatNgn(result.checkout.amount_ngn)}/mo`
                  : ''}
              </p>
              <p className={clsx('mt-2', dark ? 'text-slate-400' : 'text-slate-600')}>
                {result.message || 'Complete payment to activate your API key.'}
              </p>
            </div>
          ) : null}
        </form>

        <section className="mt-8 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-lg font-semibold">Quickstart</h3>
            <a
              href={docsUrl}
              target="_blank"
              rel="noreferrer"
              className={clsx(
                'text-xs font-semibold underline-offset-2 hover:underline',
                dark ? 'text-sky-400' : 'text-sky-700',
              )}
            >
              Open API docs
            </a>
          </div>
          <pre
            className={clsx(
              'overflow-x-auto rounded-xl border p-3 text-[11px] leading-relaxed',
              dark ? 'border-slate-800 bg-slate-950 text-slate-200' : 'border-slate-200 bg-slate-900 text-slate-100',
            )}
          >
            {curlSample}
          </pre>
          <ul className={clsx('list-disc space-y-1 pl-5 text-xs', dark ? 'text-slate-400' : 'text-slate-600')}>
            <li><code className="font-mono">GET /v1/location/site-assessment</code></li>
            <li><code className="font-mono">GET /v1/location/terrain</code></li>
            <li><code className="font-mono">GET /v1/location/nearby-settlements</code></li>
            <li><code className="font-mono">GET /v1/stations</code> · urban-flash · flood-risk</li>
          </ul>
        </section>

        <p className={clsx('mt-10 text-[11px] leading-relaxed', dark ? 'text-slate-500' : 'text-slate-500')}>
          Flood forecasts are approximate and for early awareness only. Always confirm with NIHSA,
          NEMA, and local emergency services before operational or legal decisions.
        </p>
      </div>
    </div>
  )
}
