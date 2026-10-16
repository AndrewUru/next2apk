'use client';
import { createClient } from '@supabase/supabase-js';
const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
export default function Page() { return <button onClick={() => client.auth.signInWithOAuth({ provider: 'github' })}>Sign in</button>; }
