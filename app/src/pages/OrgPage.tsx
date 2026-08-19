import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Organization, Plant } from '../lib/types'

export default function OrgPage() {
  const { orgSlug } = useParams<{ orgSlug: string }>()
  const [org, setOrg] = useState<Organization | null>(null)
  const [plants, setPlants] = useState<Plant[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!orgSlug) return

    async function load() {
      setLoading(true)
      setError(null)

      const { data: orgData, error: orgErr } = await supabase
        .from('organizations_public')
        .select('*')
        .eq('slug', orgSlug!)
        .single()

      if (orgErr || !orgData) {
        setError(orgErr?.message ?? 'Organization not found')
        setLoading(false)
        return
      }

      const typedOrg = orgData as unknown as Organization
      setOrg(typedOrg)
      console.log('Organization:', typedOrg)

      const { data: plantData, error: plantErr } = await supabase
        .from('plants')
        .select('*')
        .eq('org_id', typedOrg.id)
        .eq('is_active', true)
        .order('sort_order')

      if (plantErr) {
        setError(plantErr.message)
        setLoading(false)
        return
      }

      const typedPlants = (plantData ?? []) as unknown as Plant[]
      setPlants(typedPlants)
      console.log('Plants:', typedPlants)
      setLoading(false)
    }

    load()
  }, [orgSlug])

  if (loading) {
    return <div style={{ padding: 32, textAlign: 'center' }}>Loading...</div>
  }

  if (error) {
    return <div style={{ padding: 32, textAlign: 'center', color: '#c55' }}>{error}</div>
  }

  if (!org) {
    return <div style={{ padding: 32, textAlign: 'center' }}>Organization not found</div>
  }

  return (
    <div style={{ padding: 32, maxWidth: 600, margin: '0 auto' }}>
      <h1>{org.name}</h1>
      {org.tagline && <p style={{ color: '#888' }}>{org.tagline}</p>}
      <p style={{ marginTop: 16 }}>
        <strong>{plants.length}</strong> active plants loaded. Check the console for full data.
      </p>
      <ul style={{ marginTop: 12, listStyle: 'none', padding: 0 }}>
        {plants.map((p) => (
          <li key={p.id} style={{ padding: '4px 0' }}>
            {p.emoji} {p.name} <span style={{ color: '#aaa' }}>({p.face})</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
