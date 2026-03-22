import { useEffect, useRef, useState } from 'react'

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000'

export function useGaugeFeed() {
  const [readings, setReadings] = useState({})   // { [station_id]: reading }
  const ws = useRef(null)

  useEffect(() => {
    function connect() {
      ws.current = new WebSocket(`${WS_URL}/ws/gauge-readings`)

      ws.current.onmessage = (evt) => {
        const msg = JSON.parse(evt.data)
        if (msg.type === 'gauge_update') {
          setReadings(prev => {
            const next = { ...prev }
            for (const r of msg.data) next[r.station_id] = r
            return next
          })
        }
      }

      ws.current.onclose = () => setTimeout(connect, 5000)   // auto-reconnect
      ws.current.onerror = () => ws.current.close()

      // Keepalive ping every 20 s
      const ping = setInterval(() => {
        if (ws.current?.readyState === WebSocket.OPEN) ws.current.send('ping')
      }, 20_000)

      return () => clearInterval(ping)
    }

    const cleanup = connect()
    return () => {
      cleanup?.()
      ws.current?.close()
    }
  }, [])

  return readings
}
