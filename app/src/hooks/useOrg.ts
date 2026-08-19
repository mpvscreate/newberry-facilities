import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Organization } from '../lib/types'

export function useOrg(slug: string | undefined) {
  const [org, setOrg] = useState<Organization | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!slug) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setError(null)

    supabase
      .from('organizations_public')
      .select('*')
      .eq('slug', slug)
      .single()
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err || !data) {
          setError(err?.message ?? 'Organization not found')
          setOrg(null)
        } else {
          setOrg(data as unknown as Organization)
        }
        setLoading(false)
      })

    return () => { cancelled = true }
  }, [slug])

  return { org, loading, error }
}
