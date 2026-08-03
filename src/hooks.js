import { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'

export function useFetch(fn, deps = []) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fn()
      .then(d => { if (alive) { setData(d); setError(null) } })
      .catch(e => { if (alive) setError(e) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps])

  const reload = useCallback(() => setTick(t => t + 1), [])
  return { data, loading, error, reload }
}

export function useForm(initial) {
  const [values, setValues] = useState(initial)
  const set = (k) => (e) => setValues(v => ({ ...v, [k]: e.target ? e.target.value : e }))
  const patch = (obj) => setValues(v => ({ ...v, ...obj }))
  const reset = (next) => setValues(next || initial)
  return { values, set, patch, reset }
}
