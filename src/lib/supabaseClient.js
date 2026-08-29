import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  console.warn('[supabase] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set — login will not work until .env is configured')
}

export const supabase = createClient(url || 'https://placeholder.supabase.co', anonKey || 'placeholder')
export default supabase
