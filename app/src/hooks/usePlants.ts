import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Plant, CubeFace } from '../lib/types'

const FACE_ORDER: CubeFace[] = ['autumn', 'winter', 'spring', 'summer', 'companion', 'indigenous']

export function usePlants(orgId: string | undefined) {
  const [plants, setPlants] = useState<Plant[]>([])
  const [byFace, setByFace] = useState<Record<CubeFace, Plant[]>>(() => {
    const m = {} as Record<CubeFace, Plant[]>
    for (const f of FACE_ORDER) m[f] = []
    return m
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!orgId) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setError(null)

    supabase
      .from('plants')
      .select('*')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) {
          setError(err.message)
          setLoading(false)
          return
        }
        const all = (data ?? []) as unknown as Plant[]
        setPlants(all)
        const grouped = {} as Record<CubeFace, Plant[]>
        for (const f of FACE_ORDER) grouped[f] = []
        for (const p of all) {
          if (grouped[p.face]) grouped[p.face].push(p)
        }
        setByFace(grouped)
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [orgId])

  return { plants, byFace, loading, error }
}
