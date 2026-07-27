import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import Login from './Login.jsx'
import Dashboard from './Dashboard.jsx'

export default function App() {
  const [session, setSession] = useState(undefined)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <div className="center muted">Carregando…</div>
  return session ? <Dashboard session={session} /> : <Login />
}
