/** Capture the current MapLibre viewport as a JPEG data URL for reports. */

function drawPlacePin(ctx, x, y, scale = 1) {
  const r = 8 * scale
  const stroke = 3 * scale

  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, r + stroke * 0.35, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(2, 132, 199, 0.28)'
  ctx.fill()

  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fillStyle = '#0284c7'
  ctx.shadowColor = 'rgba(2, 132, 199, 0.55)'
  ctx.shadowBlur = 10 * scale
  ctx.fill()
  ctx.shadowBlur = 0

  ctx.lineWidth = stroke
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()
  ctx.restore()
}

/**
 * @param {import('maplibre-gl').Map | null} map
 * @param {{
 *   quality?: number,
 *   timeoutMs?: number,
 *   markers?: Array<{ lon: number, lat: number, kind?: string }>,
 * }} [options]
 */
export function captureMapSnapshot(map, { quality = 0.88, timeoutMs = 2500, markers = [] } = {}) {
  if (!map) return Promise.resolve(null)

  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        map.off('idle', onIdle)
      } catch {
        /* map may already be removed */
      }
      resolve(value)
    }

    const grab = () => {
      try {
        const canvas = map.getCanvas()
        if (!canvas?.width || !canvas?.height) {
          finish(null)
          return
        }
        requestAnimationFrame(() => {
          try {
            const rect = canvas.getBoundingClientRect()
            const scaleX = rect.width ? canvas.width / rect.width : 1
            const scaleY = rect.height ? canvas.height / rect.height : 1
            const scale = (scaleX + scaleY) / 2

            const out = document.createElement('canvas')
            out.width = canvas.width
            out.height = canvas.height
            const ctx = out.getContext('2d')
            if (!ctx) {
              finish(canvas.toDataURL('image/jpeg', quality))
              return
            }
            ctx.drawImage(canvas, 0, 0)

            for (const marker of markers) {
              const lon = Number(marker?.lon)
              const lat = Number(marker?.lat)
              if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
              const point = map.project([lon, lat])
              if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
              drawPlacePin(ctx, point.x * scaleX, point.y * scaleY, scale)
            }

            finish(out.toDataURL('image/jpeg', quality))
          } catch {
            finish(null)
          }
        })
      } catch {
        finish(null)
      }
    }

    const onIdle = () => grab()
    const timer = setTimeout(grab, timeoutMs)

    try {
      map.once('idle', onIdle)
      map.triggerRepaint()
    } catch {
      finish(null)
    }
  })
}
