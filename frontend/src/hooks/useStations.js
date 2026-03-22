import { useEffect, useState } from 'react'
import axios from 'axios'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export function useStations() {
  const [stations, setStations] = useState([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    axios.get(`${API}/stations`)
      .then(r => setStations(r.data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  return { stations, loading }
}
