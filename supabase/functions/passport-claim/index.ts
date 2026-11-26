import { createClient } from 'npm:@supabase/supabase-js@2'

Deno.serve(async request => {
  if (request.method !== 'POST') return new Response(null, { status: 405 })
  const code = request.headers.get('X-Passport-Code') ?? ''
  if (!/^[a-f0-9]{16}$/.test(code)) return new Response(null, { status: 400 })
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code))
  const digest = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data, error } = await admin.rpc('passport_claim', { digest })
  if (error) return new Response(null, { status: 503 })
  if (!data) return new Response(null, { status: 404 })
  return new Response(Uint8Array.from(atob(data), character => character.charCodeAt(0)), {
    headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' },
  })
})