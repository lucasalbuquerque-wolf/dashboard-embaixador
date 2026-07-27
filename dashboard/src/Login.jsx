import { useState } from 'react'
import { supabase } from './supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setErr(''); setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password: pw })
    if (error) setErr(error.message)
    setBusy(false)
  }

  return (
    <div className="center">
      <form className="card login" onSubmit={submit}>
        <h1>Embaixadores</h1>
        <p className="muted">Programa Umbler Talk</p>
        <input type="email" placeholder="e-mail" value={email}
               onChange={(e) => setEmail(e.target.value)} autoFocus />
        <input type="password" placeholder="senha" value={pw}
               onChange={(e) => setPw(e.target.value)} />
        <button disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
        {err && <p className="err">{err}</p>}
      </form>
    </div>
  )
}
