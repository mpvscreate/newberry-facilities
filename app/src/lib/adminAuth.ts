import { supabase } from './supabase'

let adminOrgSlug: string | null = null

export async function verifyAdminPin(orgSlug: string, pin: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('verify_admin_pin', {
    p_slug: orgSlug,
    p_pin: pin,
  })
  if (error || !data) {
    adminOrgSlug = null
    return false
  }
  adminOrgSlug = orgSlug
  return true
}

export function isAdmin(orgSlug: string): boolean {
  return adminOrgSlug === orgSlug
}

export function clearAdmin(): void {
  adminOrgSlug = null
}
