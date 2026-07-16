import React, { useState } from 'react'
import clsx from 'clsx'
import { IconChevronDown, IconChevronUp } from './Icons'
import { RISK_COLOR, RISK_LABEL } from '../lib/riskCopy'

/**
 * Public tally of settlements at elevated flood risk.
 * Supports nationwide summary or place-local summary, plus an expandable
 * clickable place list for the general outlook.
 */
export default function AffectedPlacesStat({
  summary,
  loading = false,
  theme = 'light',
  compact = false,
  scope = 'nationwide', // 'nationwide' | 'local'
  placeName = null,
  onSelectPlace,
  places: placesProp = null,
}) {
  const [listOpen, setListOpen] = useState(false)
  const dark = theme === 'dark'
  const highlyLikely =
    summary?.highly_likely ?? summary?.total ?? 0
  const totalNearby = summary?.total ?? 0
  const elevated = summary?.elevated_stations
  const byClass = summary?.by_class || {}
  const byTier = summary?.by_tier || {}
  const isLocal = scope === 'local'
  const places = placesProp ?? summary?.places ?? []
  const canList = !isLocal && places.length > 0 && typeof onSelectPlace === 'function'

  const selectPlace = (p) => {
    onSelectPlace?.({
      name: p.name,
      display_name: p.display_name || `${p.name}, Nigeria`,
      lat: p.lat,
      lon: p.lon,
      bbox_lnglat: null,
    })
  }

  if (loading && !summary) {
    return (
      <div
        className={clsx(
          compact ? 'inline-flex rounded-full border px-3 py-1.5 text-xs' : 'rounded-xl border px-3 py-3',
          dark ? 'border-gray-800 bg-gray-900/60 text-gray-500' : 'border-slate-200 bg-white text-slate-500',
        )}
      >
        {isLocal ? 'Assessing nearby places…' : 'Counting places at elevated flood risk…'}
      </div>
    )
  }

  if (!summary) return null

  const placeList = (
    <ul
      className={clsx(
        'mt-2 max-h-[min(55vh,22rem)] space-y-1 overflow-y-auto overscroll-contain',
        compact && 'max-h-[min(40vh,16rem)]',
      )}
    >
      {places.map((p) => {
        const tier = p.station_risk_tier
        const tierColor = RISK_COLOR[tier] || '#64748b'
        return (
          <li key={`${p.name}-${p.lat}-${p.lon}`}>
            <button
              type="button"
              onClick={() => selectPlace(p)}
              className={clsx(
                'flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-left text-xs transition',
                dark
                  ? 'border-gray-800 bg-gray-950/50 hover:border-gray-600'
                  : 'border-orange-100/80 bg-white/80 hover:border-orange-300 hover:bg-white',
              )}
            >
              <span className="min-w-0">
                <span className={clsx('block truncate font-medium', dark ? 'text-gray-100' : 'text-slate-800')}>
                  {p.name}
                </span>
                <span className={clsx('block truncate', dark ? 'text-gray-500' : 'text-slate-500')}>
                  {p.class || 'Town'}
                  {p.nearest_station ? ` · near ${p.nearest_station}` : ''}
                </span>
              </span>
              {tier ? (
                <span
                  className="shrink-0 text-[10px] font-semibold"
                  style={{ color: tierColor }}
                >
                  {RISK_LABEL[tier] || tier}
                </span>
              ) : null}
            </button>
          </li>
        )
      })}
    </ul>
  )

  if (compact) {
    return (
      <div className="flex min-w-0 max-w-full flex-col gap-1.5">
        <button
          type="button"
          disabled={!canList}
          onClick={() => canList && setListOpen((v) => !v)}
          className={clsx(
            'inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium shrink-0 text-left transition',
            canList && 'cursor-pointer',
            highlyLikely > 0
              ? dark
                ? 'border-orange-800/60 bg-orange-950/50 text-orange-200 hover:bg-orange-950/80'
                : 'border-orange-200 bg-orange-50 text-orange-900 hover:bg-orange-100'
              : dark
                ? 'border-teal-800/60 bg-teal-950/40 text-teal-200'
                : 'border-teal-200 bg-teal-50 text-teal-900',
            !canList && 'cursor-default',
          )}
          aria-expanded={canList ? listOpen : undefined}
        >
          <span className="tabular-nums font-bold text-sm">{highlyLikely}</span>
          <span className="truncate">
            {isLocal
              ? `highly likely near ${placeName || 'this place'}`
              : `places highly likely affected`}
          </span>
          {canList ? (
            listOpen ? <IconChevronUp size={12} /> : <IconChevronDown size={12} />
          ) : null}
        </button>
        {listOpen && canList ? (
          <div
            className={clsx(
              'w-full max-w-md rounded-xl border p-2 shadow-sm',
              dark ? 'border-gray-800 bg-gray-900' : 'border-orange-200 bg-orange-50/95',
            )}
          >
            <p className={clsx('px-1 text-[10px]', dark ? 'text-gray-500' : 'text-slate-500')}>
              Tap a place to open its outlook
            </p>
            {placeList}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div
      className={clsx(
        'rounded-xl border px-4 py-3.5',
        highlyLikely > 0
          ? dark
            ? 'border-orange-800/50 bg-orange-950/30'
            : 'border-orange-200 bg-orange-50/90'
          : dark
            ? 'border-teal-800/40 bg-teal-950/30'
            : 'border-teal-100 bg-teal-50/80',
      )}
    >
      <p
        className={clsx(
          'text-[10px] font-semibold uppercase tracking-[0.14em]',
          highlyLikely > 0
            ? dark
              ? 'text-orange-300/80'
              : 'text-orange-800'
            : dark
              ? 'text-teal-300/80'
              : 'text-teal-800',
        )}
      >
        {isLocal
          ? `Near ${placeName || 'this location'} · ~${summary.radius_km ?? 25} km`
          : 'Nationwide · Warning+ outlook'}
      </p>
      <div className="mt-1 flex items-end gap-2">
        <span
          className={clsx(
            'font-display text-4xl font-semibold tabular-nums leading-none',
            highlyLikely > 0
              ? dark
                ? 'text-orange-300'
                : 'text-orange-700'
              : dark
                ? 'text-teal-300'
                : 'text-teal-800',
          )}
        >
          {highlyLikely}
        </span>
        <span className={clsx('pb-1 text-sm', dark ? 'text-gray-300' : 'text-slate-700')}>
          {highlyLikely === 1 ? 'place' : 'places'} highly likely to be affected
        </span>
      </div>
      <p className={clsx('mt-2 text-[11px] leading-relaxed', dark ? 'text-gray-400' : 'text-slate-600')}>
        {isLocal
          ? `Of ${totalNearby} neighbouring towns/villages, counting those linked to Warning or Emergency gauge outlooks.`
          : `Towns and villages within about ${summary.radius_km ?? 25} km of ${elevated ?? 0} elevated river gauge${(elevated ?? 0) === 1 ? '' : 's'}.`}
      </p>
      {isLocal && (byTier.Emergency || byTier.Warning || byTier.Watch || byTier.Normal) ? (
        <p className={clsx('mt-1.5 text-[11px]', dark ? 'text-gray-500' : 'text-slate-500')}>
          {[
            byTier.Emergency ? `${byTier.Emergency} emergency` : null,
            byTier.Warning ? `${byTier.Warning} warning` : null,
            byTier.Watch ? `${byTier.Watch} watch` : null,
            byTier.Normal ? `${byTier.Normal} normal` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      ) : null}
      {!isLocal && (byClass.City || byClass.Town || byClass.Village) ? (
        <p className={clsx('mt-1.5 text-[11px]', dark ? 'text-gray-500' : 'text-slate-500')}>
          {[
            byClass.City ? `${byClass.City} cit${byClass.City === 1 ? 'y' : 'ies'}` : null,
            byClass.Town ? `${byClass.Town} town${byClass.Town === 1 ? '' : 's'}` : null,
            byClass.Village ? `${byClass.Village} village${byClass.Village === 1 ? '' : 's'}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      ) : null}

      {canList ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setListOpen((v) => !v)}
            className={clsx(
              'inline-flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition',
              dark
                ? 'border-orange-800/50 bg-orange-950/40 text-orange-200 hover:bg-orange-950/70'
                : 'border-orange-300 bg-white text-orange-900 hover:bg-orange-100/80',
            )}
            aria-expanded={listOpen}
          >
            <span>
              {listOpen
                ? 'Hide places'
                : `View all ${highlyLikely.toLocaleString()} place${highlyLikely === 1 ? '' : 's'}`}
            </span>
            {listOpen ? <IconChevronUp size={13} /> : <IconChevronDown size={13} />}
          </button>
          {listOpen ? (
            <>
              <p className={clsx('mt-2 text-[10px]', dark ? 'text-gray-500' : 'text-slate-500')}>
                Tap a place to open its flood outlook
              </p>
              {placeList}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
