import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !key) {
  console.error('Trūkst VITE_SUPABASE_URL vai VITE_SUPABASE_ANON_KEY — pārbaudi .env.local')
}

export const supabase = createClient(url, key)
